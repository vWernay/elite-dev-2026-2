import { eq } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { lots, receipts } from "../db/schema.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { startSettlementWorker } from "./worker.js"

const logger = () =>
  ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }) as unknown as FastifyBaseLogger

beforeEach(resetDb)

async function waitFor(check: () => Promise<boolean>, ms = 3_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

describe("startSettlementWorker", () => {
  it("liquida sozinho os lotes vencidos e para quando mandado", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 50_000 })
    const lot = await createLot(auctioneer.id)
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => addMs(T0, minutes(10)),
    )

    const worker = startSettlementWorker({
      logger: logger(),
      intervalMs: 20,
      clock: () => addMs(T0, minutes(61)),
    })
    const settled = await waitFor(async () => {
      const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
      return saved.settledAt !== null
    })
    await worker.stop()

    expect(settled).toBe(true)
    expect(await db.select().from(receipts)).toHaveLength(1)
  })

  it("registra no log o lote adulterado e continua rodando", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 50_000 })
    const lot = await createLot(auctioneer.id)
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => addMs(T0, minutes(10)),
    )
    await db
      .update(lots)
      .set({ currentBidCents: 99_999 })
      .where(eq(lots.id, lot.id))

    const log = logger()
    const worker = startSettlementWorker({
      logger: log,
      intervalMs: 20,
      clock: () => addMs(T0, minutes(61)),
    })
    const logged = await waitFor(
      async () => vi.mocked(log.warn).mock.calls.length > 0,
    )
    await worker.stop()

    expect(logged).toBe(true)
    expect(vi.mocked(log.warn).mock.calls[0][0]).toEqual({ lotId: lot.id })
    expect(await db.select().from(receipts)).toHaveLength(0)
  })

  it("não deixa nenhum ciclo rodando depois de parar", async () => {
    const onSettled = vi.fn()
    const worker = startSettlementWorker({
      logger: logger(),
      intervalMs: 10,
      onSettled,
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    await worker.stop()
    const calls = onSettled.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(onSettled.mock.calls.length).toBe(calls)
  })
})
