import { eq, sql } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { bids, lots, receipts, users } from "../db/schema.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { committedCents } from "../wallet/balance.js"
import { settleDueLots, settleLot } from "./service.js"

const inLot = (ms: number) => () => addMs(T0, ms)
const AFTER_END = inLot(minutes(61))

let auctioneer: Awaited<ReturnType<typeof createUser>>
let ana: Awaited<ReturnType<typeof createUser>>
let bruno: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  await resetDb()
  auctioneer = await createUser({ role: "auctioneer" })
  ana = await createUser({ balanceCents: 100_000 })
  bruno = await createUser({ balanceCents: 100_000 })
})

const bid = (lotId: string, bidderId: string, amountCents: number, at = 10) =>
  placeBid({ lotId, bidderId, amountCents }, inLot(minutes(at)))

const balance = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0].balanceCents

async function totalMoney() {
  const [row] = await db
    .select({ total: sql<string>`sum(${users.balanceCents})` })
    .from(users)
  return Number(row.total)
}

const getLot = async (id: string) =>
  (await db.select().from(lots).where(eq(lots.id, id)))[0]

describe("settleLot: lote com lances", () => {
  it("debita o vencedor, credita o leiloeiro e emite o comprovante", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000, 10)
    await bid(lot.id, bruno.id, 12_000, 20)

    const result = await settleLot(lot.id, AFTER_END)

    expect(result).toMatchObject({
      outcome: "sold",
      winnerId: bruno.id,
      amountCents: 12_000,
    })
    expect(await balance(bruno.id)).toBe(88_000)
    expect(await balance(auctioneer.id)).toBe(12_000)
    expect(await balance(ana.id)).toBe(100_000)

    const [receipt] = await db.select().from(receipts)
    const saved = await getLot(lot.id)
    expect(receipt).toMatchObject({
      lotId: lot.id,
      winnerId: bruno.id,
      amountCents: 12_000,
    })
    expect(receipt.chainMac).toBe(saved.headMac)
    expect(saved.settledAt).toEqual(addMs(T0, minutes(61)))
  })

  it("não cria nem destrói dinheiro", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)
    const before = await totalMoney()
    await settleLot(lot.id, AFTER_END)
    expect(await totalMoney()).toBe(before)
  })

  it("libera o comprometido: o saldo do vencedor cai, mas o disponível bate", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)
    await settleLot(lot.id, AFTER_END)
    // sem lote em aberto, nada fica comprometido; o saldo já foi debitado
    expect(await committedCents(db, ana.id)).toBe(0)
    expect(await balance(ana.id)).toBe(90_000)
  })

  it("liquida o mesmo lote só uma vez", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)

    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("sold")
    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("skipped")

    expect(await db.select().from(receipts)).toHaveLength(1)
    expect(await balance(ana.id)).toBe(90_000)
    expect(await balance(auctioneer.id)).toBe(10_000)
  })

  it("duas liquidações simultâneas do mesmo lote geram um só comprovante", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)

    const results = await Promise.all([
      settleLot(lot.id, AFTER_END),
      settleLot(lot.id, AFTER_END),
      settleLot(lot.id, AFTER_END),
    ])

    expect(results.filter((r) => r.outcome === "sold")).toHaveLength(1)
    expect(await db.select().from(receipts)).toHaveLength(1)
    expect(await balance(ana.id)).toBe(90_000)
    expect(await balance(auctioneer.id)).toBe(10_000)
  })

  it("pula o lote que outra transação está usando e liquida depois", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)

    await db.transaction(async (tx) => {
      await tx.select().from(lots).where(eq(lots.id, lot.id)).for("update")
      expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("skipped")
    })

    expect(await db.select().from(receipts)).toHaveLength(0)
    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("sold")
  })

  it("dois workers simultâneos também liquidam cada lote uma vez", async () => {
    for (const amount of [10_000, 11_000, 12_000]) {
      const lot = await createLot(auctioneer.id)
      await bid(lot.id, ana.id, amount)
    }
    await Promise.all([settleDueLots(AFTER_END), settleDueLots(AFTER_END)])

    expect(await db.select().from(receipts)).toHaveLength(3)
    expect(await balance(ana.id)).toBe(100_000 - 33_000)
    expect(await balance(auctioneer.id)).toBe(33_000)
  })

  it("o mesmo vencedor em vários lotes paga cada um", async () => {
    const lotA = await createLot(auctioneer.id)
    const lotB = await createLot(auctioneer.id)
    await bid(lotA.id, ana.id, 30_000)
    await bid(lotB.id, ana.id, 40_000)

    await settleDueLots(AFTER_END)
    expect(await balance(ana.id)).toBe(30_000)
    expect(await balance(auctioneer.id)).toBe(70_000)
  })
})

describe("settleLot: quando não liquida", () => {
  it("lote sem lances fecha sem vencedor e sem comprovante", async () => {
    const lot = await createLot(auctioneer.id)
    const before = await totalMoney()

    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("unsold")

    expect((await getLot(lot.id)).settledAt).not.toBeNull()
    expect(await db.select().from(receipts)).toHaveLength(0)
    expect(await totalMoney()).toBe(before)
  })

  it("não liquida antes do fim", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)
    const result = await settleLot(lot.id, inLot(minutes(59)))
    expect(result.outcome).toBe("skipped")
    expect((await getLot(lot.id)).settledAt).toBeNull()
  })

  it("liquida no instante exato do fim", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)
    expect((await settleLot(lot.id, inLot(minutes(60)))).outcome).toBe("sold")
  })

  it("respeita a prorrogação do anti-sniping", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000, 59.5)
    // fim original: 60min; depois do lance, o fim passa a 61min30s
    expect((await settleLot(lot.id, inLot(minutes(60)))).outcome).toBe(
      "skipped",
    )
    expect((await settleLot(lot.id, inLot(minutes(61)))).outcome).toBe(
      "skipped",
    )
    expect((await settleLot(lot.id, inLot(minutes(61.6)))).outcome).toBe("sold")
  })

  it("ignora lote cancelado", async () => {
    const lot = await createLot(auctioneer.id, { cancelledAt: T0 })
    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("skipped")
    expect((await getLot(lot.id)).settledAt).toBeNull()
  })

  it("ignora lote que não existe", async () => {
    const result = await settleLot("00000000-0000-4000-8000-000000000000")
    expect(result.outcome).toBe("skipped")
  })

  it("não liquida lote com cadeia adulterada e não mexe em dinheiro", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000, 10)
    await bid(lot.id, bruno.id, 12_000, 20)
    await db.update(bids).set({ amountCents: 1 }).where(eq(bids.seq, 2))
    const before = await totalMoney()

    expect((await settleLot(lot.id, AFTER_END)).outcome).toBe("tampered")

    expect((await getLot(lot.id)).settledAt).toBeNull()
    expect(await db.select().from(receipts)).toHaveLength(0)
    expect(await totalMoney()).toBe(before)
    expect(await balance(bruno.id)).toBe(100_000)
  })

  it("lote adulterado não trava os outros", async () => {
    const bad = await createLot(auctioneer.id, {
      endsAt: addMs(T0, minutes(30)),
    })
    const good = await createLot(auctioneer.id)
    await bid(bad.id, ana.id, 10_000)
    await bid(good.id, bruno.id, 10_000)
    await db.update(bids).set({ amountCents: 1 }).where(eq(bids.lotId, bad.id))

    const results = await settleDueLots(AFTER_END)

    expect(results.map((r) => r.outcome).sort()).toEqual(["sold", "tampered"])
    expect((await getLot(good.id)).settledAt).not.toBeNull()
  })

  it("falha de um lote desfaz só aquele lote e os outros seguem", async () => {
    const broken = await createLot(auctioneer.id, {
      endsAt: addMs(T0, minutes(30)),
    })
    const good = await createLot(auctioneer.id)
    await bid(broken.id, ana.id, 10_000)
    await bid(good.id, bruno.id, 10_000)
    // saldo corrompido: o CHECK do banco impede ficar negativo
    await db.update(users).set({ balanceCents: 1 }).where(eq(users.id, ana.id))

    const results = await settleDueLots(AFTER_END)

    expect(results.map((r) => r.outcome).sort()).toEqual(["failed", "sold"])
    expect((await getLot(broken.id)).settledAt).toBeNull()
    expect(await balance(ana.id)).toBe(1)
    expect(await db.select().from(receipts)).toHaveLength(1)
  })
})

describe("settleDueLots", () => {
  it("só pega lotes vencidos, não liquidados e não cancelados", async () => {
    const due = await createLot(auctioneer.id)
    await createLot(auctioneer.id, { endsAt: addMs(T0, minutes(120)) })
    await createLot(auctioneer.id, { cancelledAt: T0 })
    await createLot(auctioneer.id, { settledAt: T0 })

    const results = await settleDueLots(AFTER_END)
    expect(results).toEqual([{ outcome: "unsold", lotId: due.id }])
  })
})

describe("lance depois da liquidação", () => {
  it("é recusado mesmo que o relógio do lance ainda esteja dentro da janela", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana.id, 10_000)
    await settleLot(lot.id, AFTER_END)

    await expect(bid(lot.id, bruno.id, 20_000, 30)).rejects.toMatchObject({
      code: "LOT_ENDED",
    })
  })
})
