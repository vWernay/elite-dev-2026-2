import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { chain } from "../audit/index.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { bids, receipts } from "../db/schema.js"
import { settleLot } from "../settlement/service.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const AFTER_END = () => addMs(T0, minutes(61))

// Liquida um lote em que o Bruno vence a Ana.
async function soldLot() {
  const auctioneer = await createUser({
    role: "auctioneer",
    name: "Leiloeiro Secreto",
    email: "leiloeiro.secreto@teste.com",
  })
  const ana = await createUser({ balanceCents: 100_000 })
  const bruno = await createUser({
    name: "Bruno Secreto",
    email: "bruno.secreto@teste.com",
    balanceCents: 100_000,
  })
  const lot = await createLot(auctioneer.id, { title: "Black Lotus" })
  await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 10_000 }, () =>
    addMs(T0, minutes(10)),
  )
  await placeBid(
    { lotId: lot.id, bidderId: bruno.id, amountCents: 12_000 },
    () => addMs(T0, minutes(20)),
  )
  const result = await settleLot(lot.id, AFTER_END)
  if (result.outcome !== "sold") throw new Error("lote não foi liquidado")
  return { lot, ana, bruno, auctioneer, receiptId: result.receiptId }
}

const getReceipt = (id: string) =>
  app.inject({ method: "GET", url: `/api/receipts/${id}` })

describe("GET /api/receipts/:id", () => {
  it("é público e traz o item, o valor e o pseudônimo do vencedor", async () => {
    const { lot, bruno, receiptId } = await soldLot()
    const response = await getReceipt(receiptId)

    expect(response.statusCode).toBe(200)
    const [saved] = await db.select().from(receipts)
    expect(response.json()).toEqual({
      id: receiptId,
      lot: {
        id: lot.id,
        title: "Black Lotus",
        imageUrl: lot.imageUrl,
        attributes: {},
      },
      winnerPseudonym: chain.pseudonym(lot.id, bruno.id),
      amountCents: 12_000,
      issuedAt: saved.issuedAt.toISOString(),
      fingerprint: saved.chainMac.slice(0, 16),
      chainValid: true,
    })
  })

  it("não expõe dados pessoais nem ids de usuários", async () => {
    const { ana, bruno, auctioneer, receiptId } = await soldLot()
    const raw = (await getReceipt(receiptId)).body

    for (const secret of [
      "Bruno Secreto",
      "bruno.secreto",
      "Leiloeiro Secreto",
      "leiloeiro.secreto",
      bruno.id,
      ana.id,
      auctioneer.id,
    ]) {
      expect(raw).not.toContain(secret)
    }
  })

  it("a impressão digital é a mesma da auditoria do lote", async () => {
    const { receiptId } = await soldLot()
    const [saved] = await db.select().from(receipts)
    const body = (await getReceipt(receiptId)).json()
    expect(body.fingerprint).toBe(chain.fingerprint(saved.chainMac))
  })

  it("responde 404 e 400", async () => {
    const missing = await getReceipt("00000000-0000-4000-8000-000000000000")
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe("NOT_FOUND")
    expect((await getReceipt("nao-e-uuid")).statusCode).toBe(400)
  })

  describe("detecta adulteração", () => {
    it("valor do comprovante alterado", async () => {
      const { receiptId } = await soldLot()
      await db.update(receipts).set({ amountCents: 1 })
      expect((await getReceipt(receiptId)).json().chainValid).toBe(false)
    })

    it("vencedor do comprovante trocado", async () => {
      const { ana, receiptId } = await soldLot()
      await db.update(receipts).set({ winnerId: ana.id })
      expect((await getReceipt(receiptId)).json().chainValid).toBe(false)
    })

    it("chain_mac do comprovante alterado", async () => {
      const { receiptId } = await soldLot()
      await db.update(receipts).set({ chainMac: "0".repeat(64) })
      expect((await getReceipt(receiptId)).json().chainValid).toBe(false)
    })

    it("lance alterado no histórico", async () => {
      const { receiptId } = await soldLot()
      await db.update(bids).set({ amountCents: 11_999 }).where(eq(bids.seq, 2))
      expect((await getReceipt(receiptId)).json().chainValid).toBe(false)
    })

    it("último lance removido do histórico", async () => {
      const { receiptId } = await soldLot()
      await db.delete(bids).where(eq(bids.seq, 2))
      expect((await getReceipt(receiptId)).json().chainValid).toBe(false)
    })
  })
})
