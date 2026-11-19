import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { lots, users } from "../db/schema.js"
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
    expect((await listMine(cookies)).json()).toEqual({
      lots: [],
      total: 0,
      counts: { all: 0, ongoing: 0, won: 0, lost: 0 },
    })
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

    expect((await listMine(me.cookies)).json().lots).toEqual([])
  })
})

describe("GET /api/bidder/lots: filtro e paginação", () => {
  const query = (cookies: { token: string }, params: string) =>
    app.inject({
      method: "GET",
      url: `/api/bidder/lots?${params}`,
      cookies,
    })
  const titles = (body: { lots: { title: string }[] }) =>
    body.lots.map((l) => l.title)

  // 2 em disputa, 2 vencidos, 1 perdido e 1 cancelado
  async function mixed() {
    const auctioneer = await createUser({ role: "auctioneer" })
    const me = await register(app, "bidder")
    const rival = await createUser({ balanceCents: 500_000 })
    await setBalance(me.id, 500_000)
    // o fim de cada lote define a ordem da lista (mais tarde primeiro)
    const make = (title: string, hoursToEnd: number) =>
      createLot(auctioneer.id, {
        title,
        endsAt: addMs(T0, minutes(60 + hoursToEnd)),
      })

    const ongoingA = await make("Disputa A", 6)
    const ongoingB = await make("Disputa B", 5)
    const wonA = await make("Vencido A", 4)
    const wonB = await make("Vencido B", 3)
    const lost = await make("Perdido", 2)
    const cancelled = await make("Cancelado", 1)

    for (const lot of [ongoingA, ongoingB, wonA, wonB, lost, cancelled]) {
      await bid(lot.id, me.id, 10_000)
    }
    await bid(lost.id, rival.id, 11_000, 20)
    for (const lot of [wonA, wonB, lost]) {
      await settleLot(lot.id, () => addMs(T0, minutes(60 + 24 * 60)))
    }
    await db
      .update(lots)
      .set({ cancelledAt: T0 })
      .where(eq(lots.id, cancelled.id))
    return me
  }

  it("filtra no banco e o total acompanha o filtro", async () => {
    const me = await mixed()
    const won = (await query(me.cookies, "filter=won")).json()
    expect(titles(won).sort()).toEqual(["Vencido A", "Vencido B"])
    expect(won.total).toBe(2)

    const ongoing = (await query(me.cookies, "filter=ongoing")).json()
    expect(titles(ongoing).sort()).toEqual(["Disputa A", "Disputa B"])
    expect(ongoing.total).toBe(2)

    const lost = (await query(me.cookies, "filter=lost")).json()
    expect(titles(lost)).toEqual(["Perdido"])

    const all = (await query(me.cookies, "filter=all")).json()
    expect(all.total).toBe(6)
  })

  it("as contagens valem para todos os lotes, seja qual for o filtro e a página", async () => {
    const me = await mixed()
    const counts = { all: 6, ongoing: 2, won: 2, lost: 1 }
    for (const params of [
      "filter=won",
      "limit=1&offset=3",
      "filter=lost&limit=1",
    ]) {
      expect((await query(me.cookies, params)).json().counts).toEqual(counts)
    }
  })

  it("pagina do lote que termina mais tarde para o mais cedo", async () => {
    const me = await mixed()
    const first = (await query(me.cookies, "limit=4&offset=0")).json()
    const second = (await query(me.cookies, "limit=4&offset=4")).json()
    expect(titles(first)).toEqual([
      "Disputa A",
      "Disputa B",
      "Vencido A",
      "Vencido B",
    ])
    expect(titles(second)).toEqual(["Perdido", "Cancelado"])
    expect(first.total).toBe(6)
  })

  it("o maior lance vem certo nos itens da página", async () => {
    const me = await mixed()
    const page = (await query(me.cookies, "limit=1&offset=0")).json()
    expect(page.lots[0]).toMatchObject({
      title: "Disputa A",
      myHighestBidCents: 10_000,
    })
  })

  it("recusa filtro desconhecido e limites inválidos", async () => {
    const me = await register(app, "bidder")
    for (const params of ["filter=x", "limit=0", "limit=101", "offset=-1"]) {
      expect((await query(me.cookies, params)).statusCode).toBe(400)
    }
  })
})
