import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { cancelLot } from "../lots/service.js"
import { settleLot } from "../settlement/service.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { chain } from "./index.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const audit = async (lotId: string) =>
  app.inject({ method: "GET", url: `/api/lots/${lotId}/audit` })

const run = async (...statements: string[]) => {
  for (const statement of statements) await db.execute(sql.raw(statement))
}

// Lote com três lances: Ana 100, Bruno 105, Ana 110.
async function lotWithBids() {
  const auctioneer = await createUser({
    role: "auctioneer",
    name: "Leiloeiro Secreto",
    email: "leiloeiro.secreto@teste.com",
  })
  const ana = await createUser({
    name: "Ana Secreta",
    email: "ana.secreta@teste.com",
    balanceCents: 100_000,
  })
  const bruno = await createUser({ balanceCents: 100_000 })
  const lot = await createLot(auctioneer.id, { title: "Black Lotus" })
  const bid = (user: { id: string }, amountCents: number, at: number) =>
    placeBid({ lotId: lot.id, bidderId: user.id, amountCents }, () =>
      addMs(T0, minutes(at)),
    )
  await bid(ana, 10_000, 10)
  await bid(bruno, 10_500, 20)
  await bid(ana, 11_000, 30)
  return { lot, ana, bruno, auctioneer }
}

describe("GET /api/lots/:id/audit: lote íntegro", () => {
  it("é público e mostra o histórico completo como íntegro", async () => {
    const { lot, ana, bruno } = await lotWithBids()
    const response = await audit(lot.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      lotId: lot.id,
      title: "Black Lotus",
      status: "ended",
      verdict: "intact",
      firstInvalidSeq: null,
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      issues: [],
      chainVersion: 2,
      originalEndsAt: addMs(T0, minutes(60)).toISOString(),
      endsAt: addMs(T0, minutes(60)).toISOString(),
      bids: [
        {
          seq: 1,
          pseudonym: chain.pseudonym(lot.id, ana.id),
          amountCents: 10_000,
          createdAt: addMs(T0, minutes(10)).toISOString(),
          valid: true,
          extendedEndsAt: null,
        },
        {
          seq: 2,
          pseudonym: chain.pseudonym(lot.id, bruno.id),
          amountCents: 10_500,
          createdAt: addMs(T0, minutes(20)).toISOString(),
          valid: true,
          extendedEndsAt: null,
        },
        {
          seq: 3,
          pseudonym: chain.pseudonym(lot.id, ana.id),
          amountCents: 11_000,
          createdAt: addMs(T0, minutes(30)).toISOString(),
          valid: true,
          extendedEndsAt: null,
        },
      ],
    })
  })

  it("identifica os licitantes sem expor dados pessoais", async () => {
    const { lot, ana, bruno, auctioneer } = await lotWithBids()
    const raw = (await audit(lot.id)).body

    for (const secret of [
      "Ana Secreta",
      "ana.secreta",
      "Leiloeiro Secreto",
      "leiloeiro.secreto",
      ana.id,
      bruno.id,
      auctioneer.id,
    ]) {
      expect(raw).not.toContain(secret)
    }
  })

  it("a impressão digital é a ponta atual da cadeia e muda a cada lance", async () => {
    const { lot, bruno } = await lotWithBids()
    const before = (await audit(lot.id)).json().fingerprint
    await placeBid(
      { lotId: lot.id, bidderId: bruno.id, amountCents: 11_500 },
      () => addMs(T0, minutes(40)),
    )
    const after = (await audit(lot.id)).json().fingerprint
    expect(after).not.toBe(before)
  })

  it("lote sem lances é íntegro", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id)
    const body = (await audit(lot.id)).json()
    expect(body).toMatchObject({ verdict: "intact", bids: [], issues: [] })
  })

  it("lote cancelado também pode ser auditado", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id)
    await cancelLot(lot.id, auctioneer.id, {}, T0)
    const body = (await audit(lot.id)).json()
    expect(body).toMatchObject({ status: "cancelled", verdict: "intact" })
  })

  it("segue íntegro depois da liquidação", async () => {
    const { lot } = await lotWithBids()
    await settleLot(lot.id, () => addMs(T0, minutes(61)))
    const body = (await audit(lot.id)).json()
    expect(body).toMatchObject({ status: "ended", verdict: "intact" })
  })

  it("responde 404 e 400", async () => {
    const missing = await audit("00000000-0000-4000-8000-000000000000")
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe("NOT_FOUND")
    expect((await audit("nao-e-uuid")).statusCode).toBe(400)
  })
})

// Os mesmos comandos SQL que o README entrega ao avaliador.
describe("GET /api/lots/:id/audit: adulteração direto no banco", () => {
  it("valor de um lance alterado", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE bids SET amount_cents = amount_cents + 100 WHERE lot_id = '${lot.id}' AND seq = 1`,
    )

    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.firstInvalidSeq).toBe(1)
    expect(body.bids.map((b: { valid: boolean }) => b.valid)).toEqual([
      false,
      true,
      true,
    ])
  })

  it("último lance apagado", async () => {
    const { lot } = await lotWithBids()
    await run(
      `DELETE FROM bids WHERE lot_id = '${lot.id}' AND seq = (SELECT max(seq) FROM bids WHERE lot_id = '${lot.id}')`,
    )

    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("truncated")
    expect(body.firstInvalidSeq).toBeNull()
    expect(body.bids).toHaveLength(2)
    expect(body.issues).toEqual(
      expect.arrayContaining(["COUNT_MISMATCH", "HEAD_MISMATCH"]),
    )
  })

  it("lance falso inserido", async () => {
    const { lot } = await lotWithBids()
    await run(
      `INSERT INTO bids (lot_id, bidder_id, seq, amount_cents, created_at, mac)
       SELECT lot_id, bidder_id, seq + 1, amount_cents + 1000, now(), repeat('0', 64)
       FROM bids WHERE lot_id = '${lot.id}' ORDER BY seq DESC LIMIT 1`,
    )

    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.firstInvalidSeq).toBe(4)
    expect(body.bids).toHaveLength(4)
  })

  it("seq trocado entre dois lances", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE bids SET seq = 99 WHERE lot_id = '${lot.id}' AND seq = 1`,
      `UPDATE bids SET seq = 1 WHERE lot_id = '${lot.id}' AND seq = 2`,
      `UPDATE bids SET seq = 2 WHERE lot_id = '${lot.id}' AND seq = 99`,
    )

    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.firstInvalidSeq).toBe(1)
  })

  it("lance removido do meio", async () => {
    const { lot } = await lotWithBids()
    await run(`DELETE FROM bids WHERE lot_id = '${lot.id}' AND seq = 2`)

    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.firstInvalidSeq).toBe(3)
  })

  it("licitante de um lance trocado", async () => {
    const { lot, bruno } = await lotWithBids()
    await run(
      `UPDATE bids SET bidder_id = '${bruno.id}' WHERE lot_id = '${lot.id}' AND seq = 1`,
    )
    expect((await audit(lot.id)).json().firstInvalidSeq).toBe(1)
  })

  it("horário de um lance alterado", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE bids SET created_at = created_at + interval '1 second' WHERE lot_id = '${lot.id}' AND seq = 2`,
    )
    expect((await audit(lot.id)).json().firstInvalidSeq).toBe(2)
  })

  it("mac de um lance editado", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE bids SET mac = repeat('a', 64) WHERE lot_id = '${lot.id}' AND seq = 2`,
    )
    expect((await audit(lot.id)).json().firstInvalidSeq).toBe(2)
  })

  it("valor atual ou líder do lote alterados", async () => {
    const { lot, bruno } = await lotWithBids()
    await run(
      `UPDATE lots SET current_bid_cents = 999999 WHERE id = '${lot.id}'`,
    )
    let body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toEqual(["LOT_STATE_MISMATCH"])
    expect(body.bids.every((b: { valid: boolean }) => b.valid)).toBe(true)

    await run(
      `UPDATE lots SET current_bid_cents = 11000, leader_id = '${bruno.id}' WHERE id = '${lot.id}'`,
    )
    body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toEqual(["LOT_STATE_MISMATCH"])
  })

  it("lance inicial ou incremento alterados depois dos lances", async () => {
    const { lot } = await lotWithBids()
    await run(`UPDATE lots SET starting_bid_cents = 1 WHERE id = '${lot.id}'`)
    expect((await audit(lot.id)).json()).toMatchObject({
      verdict: "tampered",
      firstInvalidSeq: 1,
    })
  })

  it("início do lote alterado, mesmo sem lances", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id)
    await run(
      `UPDATE lots SET starts_at = starts_at - interval '1 hour' WHERE id = '${lot.id}'`,
    )
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toContain("HEAD_MISMATCH")
  })

  it("head_mac e bid_count reescritos para esconder a remoção", async () => {
    const { lot } = await lotWithBids()
    await run(
      `DELETE FROM bids WHERE lot_id = '${lot.id}' AND seq = 3`,
      `UPDATE lots SET bid_count = 2, head_mac = repeat('b', 64), current_bid_cents = 10500, leader_id = (SELECT bidder_id FROM bids WHERE lot_id = '${lot.id}' AND seq = 2) WHERE id = '${lot.id}'`,
    )
    expect((await audit(lot.id)).json().verdict).toBe("tampered")
  })

  it("a impressão digital muda quando o head_mac é mexido", async () => {
    const { lot } = await lotWithBids()
    const before = (await audit(lot.id)).json().fingerprint
    await run(
      `UPDATE lots SET head_mac = repeat('c', 64) WHERE id = '${lot.id}'`,
    )
    const body = (await audit(lot.id)).json()
    expect(body.fingerprint).not.toBe(before)
    expect(body.verdict).toBe("tampered")
  })

  it("lote liquidado e depois adulterado também é detectado", async () => {
    const { lot } = await lotWithBids()
    await settleLot(lot.id, () => addMs(T0, minutes(61)))
    await run(
      `UPDATE bids SET amount_cents = amount_cents + 100 WHERE lot_id = '${lot.id}' AND seq = 3`,
    )
    expect((await audit(lot.id)).json()).toMatchObject({
      verdict: "tampered",
      firstInvalidSeq: 3,
    })
  })
})

describe("GET /api/lots/:id/audit: fim, cancelamento e liquidação (cadeia v2)", () => {
  it("alterar ends_at é detectado", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE lots SET ends_at = ends_at + interval '1 day' WHERE id = '${lot.id}'`,
    )
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toContain("HEAD_MISMATCH")
    expect(body.issues).toContain("ENDS_AT_MISMATCH")
  })

  it("alterar original_ends_at é detectado desde o lance #1", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE lots SET original_ends_at = original_ends_at + interval '1 day' WHERE id = '${lot.id}'`,
    )
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.firstInvalidSeq).toBe(1)
  })

  it("apagar cancelled_at de um lote cancelado é detectado", async () => {
    const { lot, auctioneer } = await lotWithBids()
    // lote ainda no ar: cancela pelo serviço, como a API faz
    await cancelLot(lot.id, auctioneer.id, { confirmBids: true }, T0)
    expect((await audit(lot.id)).json().verdict).toBe("intact")

    await run(`UPDATE lots SET cancelled_at = NULL WHERE id = '${lot.id}'`)
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toEqual(["HEAD_MISMATCH"])
  })

  it("preencher settled_at sem liquidar é detectado", async () => {
    const { lot } = await lotWithBids()
    await run(`UPDATE lots SET settled_at = now() WHERE id = '${lot.id}'`)
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("tampered")
    expect(body.issues).toEqual(["HEAD_MISMATCH"])
  })

  it("apagar settled_at de um lote liquidado é detectado", async () => {
    const { lot } = await lotWithBids()
    await settleLot(lot.id, () => addMs(T0, minutes(61)))
    expect((await audit(lot.id)).json().verdict).toBe("intact")

    await run(`UPDATE lots SET settled_at = NULL WHERE id = '${lot.id}'`)
    expect((await audit(lot.id)).json().verdict).toBe("tampered")
  })

  it("alterar o fim gravado em um lance invalida aquele lance", async () => {
    const { lot } = await lotWithBids()
    await run(
      `UPDATE bids SET ends_at_after = ends_at_after + interval '1 hour' WHERE lot_id = '${lot.id}' AND seq = 2`,
    )
    expect((await audit(lot.id)).json().firstInvalidSeq).toBe(2)
  })

  it("mostra qual lance prorrogou o fim", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 100_000 })
    const lot = await createLot(auctioneer.id)
    // 1 minuto antes do fim: o anti-sniping empurra o fim para 2 min depois
    const at = addMs(T0, minutes(59))
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => at,
    )
    const body = (await audit(lot.id)).json()
    expect(body.verdict).toBe("intact")
    expect(body.bids[0].extendedEndsAt).toBe(
      addMs(at, minutes(2)).toISOString(),
    )
    expect(body.endsAt).toBe(body.bids[0].extendedEndsAt)

    // desfazer a prorrogação no lote é detectado
    await run(
      `UPDATE lots SET ends_at = original_ends_at WHERE id = '${lot.id}'`,
    )
    expect((await audit(lot.id)).json().verdict).toBe("tampered")
  })
})

describe("GET /api/lots/:id/audit: lotes da cadeia v1", () => {
  it("lote v1 continua íntegro e o fim dele fica fora da cadeia", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 100_000 })
    const lot = await createLot(auctioneer.id, { chainVersion: 1 })
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => addMs(T0, minutes(10)),
    )
    const body = (await audit(lot.id)).json()
    expect(body).toMatchObject({ verdict: "intact", chainVersion: 1 })
    expect(body.bids[0].extendedEndsAt).toBeNull()

    // limite da v1: alterar o fim não é detectado
    await run(
      `UPDATE lots SET ends_at = ends_at + interval '1 day' WHERE id = '${lot.id}'`,
    )
    expect((await audit(lot.id)).json().verdict).toBe("intact")
  })

  it("lance e liquidação num lote v1 seguem a fórmula antiga", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 100_000 })
    const lot = await createLot(auctioneer.id, { chainVersion: 1 })
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => addMs(T0, minutes(10)),
    )
    await settleLot(lot.id, () => addMs(T0, minutes(61)))
    expect((await audit(lot.id)).json().verdict).toBe("intact")
  })
})
