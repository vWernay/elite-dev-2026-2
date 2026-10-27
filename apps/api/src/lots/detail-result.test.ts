import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { chain } from "../audit/index.js"
import { placeBid } from "../bids/service.js"
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

const detail = async (id: string) =>
  (await app.inject({ method: "GET", url: `/api/lots/${id}` })).json()

const now = () => new Date()
const live = () => ({
  startsAt: addMs(now(), -minutes(10)),
  endsAt: addMs(now(), minutes(60)),
})

describe("GET /api/lots/:id: result", () => {
  it("fica vazio enquanto o lote não terminou", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, live())
    expect((await detail(lot.id)).result).toEqual({
      outcome: null,
      finalAmountCents: null,
      receiptId: null,
      winnerPseudonym: null,
    })
  })

  it("lote encerrado sem lances é 'unsold'", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id)
    expect((await detail(lot.id)).result).toMatchObject({
      outcome: "unsold",
      receiptId: null,
    })
  })

  it("lote encerrado com lances e ainda não liquidado é 'settling'", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({ balanceCents: 100_000 })
    const lot = await createLot(auctioneer.id)
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 10_000 },
      () => addMs(T0, minutes(10)),
    )
    expect((await detail(lot.id)).result).toEqual({
      outcome: "settling",
      finalAmountCents: null,
      receiptId: null,
      winnerPseudonym: null,
    })
  })

  it("depois da liquidação traz o comprovante e o vencedor só por pseudônimo", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const ana = await createUser({
      name: "Ana Secreta",
      email: "ana.secreta@teste.com",
      balanceCents: 100_000,
    })
    const lot = await createLot(auctioneer.id)
    await placeBid(
      { lotId: lot.id, bidderId: ana.id, amountCents: 12_000 },
      () => addMs(T0, minutes(10)),
    )
    const settled = await settleLot(lot.id, () => addMs(T0, minutes(61)))
    if (settled.outcome !== "sold") throw new Error("não liquidou")

    const response = await app.inject({
      method: "GET",
      url: `/api/lots/${lot.id}`,
    })
    expect(response.json().result).toEqual({
      outcome: "sold",
      finalAmountCents: 12_000,
      receiptId: settled.receiptId,
      winnerPseudonym: chain.pseudonym(lot.id, ana.id),
    })
    expect(response.body).not.toContain("Ana Secreta")
    expect(response.body).not.toContain("ana.secreta")
    expect(response.body).not.toContain(ana.id)
  })

  it("lote cancelado não tem resultado", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, { cancelledAt: T0 })
    expect((await detail(lot.id)).result.outcome).toBeNull()
  })
})
