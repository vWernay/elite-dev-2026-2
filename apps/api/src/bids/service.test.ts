import { asc, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { chain } from "../audit/index.js"
import { db } from "../db/client.js"
import { bids, lots, users } from "../db/schema.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { placeBid } from "./service.js"

const inLot = (ms: number) => () => addMs(T0, ms)

let auctioneer: Awaited<ReturnType<typeof createUser>>
let ana: Awaited<ReturnType<typeof createUser>>
let bruno: Awaited<ReturnType<typeof createUser>>

beforeEach(async () => {
  await resetDb()
  auctioneer = await createUser({ role: "auctioneer" })
  ana = await createUser({ balanceCents: 100_000 })
  bruno = await createUser({ balanceCents: 100_000 })
})

const bid = (
  lotId: string,
  bidder: { id: string },
  amountCents: number,
  clock = inLot(minutes(10)),
) => placeBid({ lotId, bidderId: bidder.id, amountCents }, clock)

async function expectRejected(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

async function loadAudit(lotId: string) {
  const [lot] = await db.select().from(lots).where(eq(lots.id, lotId))
  const rows = await db
    .select()
    .from(bids)
    .where(eq(bids.lotId, lotId))
    .orderBy(asc(bids.seq))
  return chain.verify(lot, rows)
}

describe("regras de valor", () => {
  it("aceita o primeiro lance igual ao lance inicial", async () => {
    const lot = await createLot(auctioneer.id)
    const result = await bid(lot.id, ana, 10_000)

    expect(result.bid.seq).toBe(1)
    expect(result.lot.minNextBidCents).toBe(10_500)

    const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
    expect(saved.currentBidCents).toBe(10_000)
    expect(saved.leaderId).toBe(ana.id)
    expect(saved.bidCount).toBe(1)
  })

  it("recusa o primeiro lance abaixo do inicial", async () => {
    const lot = await createLot(auctioneer.id)
    await expect(bid(lot.id, ana, 9_999)).rejects.toMatchObject({
      code: "BID_BELOW_MINIMUM",
      details: { minimumCents: 10_000 },
    })
  })

  it("exige o incremento mínimo nos lances seguintes", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000)

    await expect(bid(lot.id, bruno, 10_499)).rejects.toMatchObject({
      code: "BID_BELOW_MINIMUM",
      details: { minimumCents: 10_500 },
    })
    expect((await bid(lot.id, bruno, 10_500)).bid.seq).toBe(2)
  })

  it("recusa que o líder cubra o próprio lance", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000)
    await expectRejected(bid(lot.id, ana, 20_000), "ALREADY_WINNING")
  })

  it("não grava nada quando o lance é recusado", async () => {
    const lot = await createLot(auctioneer.id)
    await expectRejected(bid(lot.id, ana, 1), "BID_BELOW_MINIMUM")
    expect(await db.select().from(bids)).toHaveLength(0)
  })
})

describe("janela do lote", () => {
  it("recusa lance antes do início", async () => {
    const lot = await createLot(auctioneer.id)
    await expect(bid(lot.id, ana, 10_000, inLot(-1))).rejects.toMatchObject({
      code: "LOT_NOT_STARTED",
      details: { startsAt: T0.toISOString() },
    })
  })

  it("aceita no instante de início e recusa no instante de fim", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000, inLot(0))
    await expectRejected(
      bid(lot.id, bruno, 10_500, inLot(minutes(60))),
      "LOT_ENDED",
    )
  })

  it("recusa lance em lote cancelado", async () => {
    const lot = await createLot(auctioneer.id, { cancelledAt: T0 })
    await expectRejected(bid(lot.id, ana, 10_000), "LOT_CANCELLED")
  })

  it("responde 404 para lote inexistente", async () => {
    await expectRejected(
      bid("00000000-0000-4000-8000-000000000000", ana, 10_000),
      "NOT_FOUND",
    )
  })
})

describe("anti-sniping", () => {
  it("estende o fim para 2 minutos depois do lance nos últimos 2 minutos", async () => {
    const lot = await createLot(auctioneer.id)
    const now = addMs(T0, minutes(59) + 30_000)
    const result = await bid(lot.id, ana, 10_000, () => now)

    expect(result.lot.extended).toBe(true)
    expect(result.lot.endsAt).toEqual(addMs(now, minutes(2)))

    const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
    expect(saved.endsAt).toEqual(addMs(now, minutes(2)))
    expect(saved.originalEndsAt).toEqual(lot.originalEndsAt)
  })

  it("não mexe no fim quando ainda falta mais de 2 minutos", async () => {
    const lot = await createLot(auctioneer.id)
    const result = await bid(lot.id, ana, 10_000, inLot(minutes(57)))

    expect(result.lot.extended).toBe(false)
    expect(result.lot.endsAt).toEqual(lot.endsAt)
  })

  it("aceita lance na prorrogação e estende de novo", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000, inLot(minutes(59)))
    // o fim agora é T0 + 61min
    const result = await bid(lot.id, bruno, 10_500, inLot(minutes(60) + 30_000))
    expect(result.lot.endsAt).toEqual(addMs(T0, minutes(62) + 30_000))
  })
})

describe("saldo comprometido", () => {
  it("recusa lance maior que o saldo disponível", async () => {
    const poor = await createUser({ balanceCents: 5_000 })
    const lot = await createLot(auctioneer.id)
    await expect(bid(lot.id, poor, 10_000)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      details: { availableCents: 5_000 },
    })
  })

  it("compromete o valor enquanto lidera e libera quando é superado", async () => {
    const user = await createUser({ balanceCents: 15_000 })
    const lotA = await createLot(auctioneer.id)
    const lotB = await createLot(auctioneer.id, { startingBidCents: 6_000 })

    await bid(lotA.id, user, 10_000)
    await expect(bid(lotB.id, user, 6_000)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      details: { availableCents: 5_000 },
    })

    await bid(lotA.id, bruno, 10_500)
    expect((await bid(lotB.id, user, 6_000)).bid.seq).toBe(1)
  })

  it("não debita o saldo no lance", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000)
    const [saved] = await db.select().from(users).where(eq(users.id, ana.id))
    expect(saved.balanceCents).toBe(100_000)
  })
})

describe("concorrência", () => {
  it("o mesmo licitante em vários lotes só consegue comprometer o que tem", async () => {
    const user = await createUser({ balanceCents: 15_000 })
    // vários lotes para as transações se sobreporem de verdade
    const manyLots = await Promise.all(
      Array.from({ length: 8 }, () => createLot(auctioneer.id)),
    )

    const results = await Promise.allSettled(
      manyLots.map((lot) => bid(lot.id, user, 10_000)),
    )

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "INSUFFICIENT_FUNDS" })
      }
    }
  })

  it("dois lances iguais no mesmo lote: um entra e o outro é recusado", async () => {
    const lot = await createLot(auctioneer.id)

    const results = await Promise.allSettled([
      bid(lot.id, ana, 10_000),
      bid(lot.id, bruno, 10_000),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((r) => r.status === "rejected")
    expect(rejected?.reason).toMatchObject({ code: "BID_BELOW_MINIMUM" })
    expect((await loadAudit(lot.id)).verdict).toBe("intact")
  })

  it("vários lances simultâneos mantêm seq contínuo e cadeia íntegra", async () => {
    const lot = await createLot(auctioneer.id, { startingBidCents: 1_000 })
    const others = await Promise.all(
      Array.from({ length: 6 }, () => createUser({ balanceCents: 1_000_000 })),
    )

    await Promise.allSettled(
      others.map((user, index) => bid(lot.id, user, 1_000 + index * 500)),
    )

    const rows = await db
      .select({ seq: bids.seq })
      .from(bids)
      .where(eq(bids.lotId, lot.id))
      .orderBy(asc(bids.seq))
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1))
    expect(rows.length).toBeGreaterThan(0)
    expect((await loadAudit(lot.id)).verdict).toBe("intact")
  })
})

describe("cadeia gravada", () => {
  it("fica íntegra depois de vários lances", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000, inLot(minutes(1)))
    await bid(lot.id, bruno, 10_500, inLot(minutes(2)))
    await bid(lot.id, ana, 11_000, inLot(minutes(3)))

    const audit = await loadAudit(lot.id)
    expect(audit.verdict).toBe("intact")
    expect(audit.bids).toHaveLength(3)
  })

  it("acusa adulteração feita direto no banco", async () => {
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, ana, 10_000, inLot(minutes(1)))
    await bid(lot.id, bruno, 10_500, inLot(minutes(2)))

    await db.update(bids).set({ amountCents: 10_001 }).where(eq(bids.seq, 1))

    const audit = await loadAudit(lot.id)
    expect(audit.verdict).toBe("tampered")
    expect(audit.firstInvalidSeq).toBe(1)
  })
})
