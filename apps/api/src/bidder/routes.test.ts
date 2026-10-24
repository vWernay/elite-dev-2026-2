import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { settleLot } from "../settlement/service.js"
import { signUp as register } from "../test/auth.js"
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

const listMine = (cookies?: { token: string }) =>
  app.inject({ method: "GET", url: "/api/bidder/lots", cookies })

const bid = (lotId: string, bidderId: string, amountCents: number, at = 10) =>
  placeBid({ lotId, bidderId, amountCents }, () => addMs(T0, minutes(at)))

const setBalance = (userId: string, balanceCents: number) =>
  db.update(users).set({ balanceCents }).where(eq(users.id, userId))

const AFTER_END = () => addMs(T0, minutes(61))

describe("GET /api/bidder/lots", () => {
  it("exige login de licitante", async () => {
    expect((await listMine()).statusCode).toBe(401)
    const auctioneer = await register(app, "auctioneer")
    expect((await listMine(auctioneer.cookies)).statusCode).toBe(403)
  })

  it("começa vazio", async () => {
    const { cookies } = await register(app, "bidder")
    expect((await listMine(cookies)).json()).toEqual({ lots: [] })
  })

  it("mostra liderando, superado, vencido e perdido, com o comprovante só de quem venceu", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const me = await register(app, "bidder")
    const rival = await createUser({ balanceCents: 500_000 })
    await setBalance(me.id, 500_000)

    // liderando e superado: lotes ainda abertos
    const leading = await createLot(auctioneer.id, { title: "Liderando" })
    const outbid = await createLot(auctioneer.id, { title: "Superado" })
    await bid(leading.id, me.id, 10_000)
    await bid(outbid.id, me.id, 10_000)
    await bid(outbid.id, rival.id, 11_000, 20)

    // vencido e perdido: lotes já liquidados
    const won = await createLot(auctioneer.id, { title: "Vencido" })
    const lost = await createLot(auctioneer.id, { title: "Perdido" })
    await bid(won.id, me.id, 15_000)
    await bid(lost.id, me.id, 15_000)
    await bid(lost.id, rival.id, 16_000, 20)
    await settleLot(won.id, AFTER_END)
    await settleLot(lost.id, AFTER_END)

    // um lote em que não dei lance não aparece
    await createLot(auctioneer.id, { title: "Alheio" })

    const body = (await listMine(me.cookies)).json()
    const byTitle = Object.fromEntries(
      body.lots.map((l: { title: string }) => [l.title, l]),
    )

    expect(Object.keys(byTitle).sort()).toEqual([
      "Liderando",
      "Perdido",
      "Superado",
      "Vencido",
    ])
    expect(byTitle.Liderando).toMatchObject({
      state: "leading",
      myHighestBidCents: 10_000,
      receiptId: null,
    })
    expect(byTitle.Superado).toMatchObject({
      state: "outbid",
      myHighestBidCents: 10_000,
      currentBidCents: 11_000,
      receiptId: null,
    })
    expect(byTitle.Vencido).toMatchObject({
      state: "won",
      myHighestBidCents: 15_000,
    })
    expect(byTitle.Vencido.receiptId).toEqual(expect.any(String))
    expect(byTitle.Perdido).toMatchObject({ state: "lost", receiptId: null })
  })

  it("usa o maior lance do usuário em cada lote", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const me = await register(app, "bidder")
    const rival = await createUser({ balanceCents: 500_000 })
    await setBalance(me.id, 500_000)
    const lot = await createLot(auctioneer.id)

    await bid(lot.id, me.id, 10_000, 10)
    await bid(lot.id, rival.id, 11_000, 20)
    await bid(lot.id, me.id, 12_000, 30)

    const [item] = (await listMine(me.cookies)).json().lots
    expect(item).toMatchObject({ myHighestBidCents: 12_000, state: "leading" })
  })

  it("não mistura lances de outros usuários", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const me = await register(app, "bidder")
    const rival = await createUser({ balanceCents: 500_000 })
    const lot = await createLot(auctioneer.id)
    await bid(lot.id, rival.id, 10_000)

    expect((await listMine(me.cookies)).json()).toEqual({ lots: [] })
  })
})
