import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { signUp as register } from "../test/auth.js"
import { createLot, createUser, resetDb } from "../test/factories.js"
import { deposit, MAX_DEPOSIT_CENTS } from "./service.js"

const app = buildApp()
const signUp = (role: "bidder" | "auctioneer") => register(app, role)

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const getWallet = (cookies: { token: string }) =>
  app.inject({ method: "GET", url: "/api/wallet", cookies })

const postDeposit = (cookies: { token: string }, payload: object) =>
  app.inject({ method: "POST", url: "/api/wallet/deposits", cookies, payload })

describe("GET /api/wallet", () => {
  it("exige login", async () => {
    const response = await app.inject({ method: "GET", url: "/api/wallet" })
    expect(response.statusCode).toBe(401)
  })

  it("é só para licitantes", async () => {
    const { cookies } = await signUp("auctioneer")
    expect((await getWallet(cookies)).statusCode).toBe(403)
  })

  it("começa zerada", async () => {
    const { cookies } = await signUp("bidder")
    const response = await getWallet(cookies)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      balanceCents: 0,
      committedCents: 0,
      availableCents: 0,
    })
  })

  it("separa o comprometido do disponível enquanto lidera", async () => {
    const { id, cookies } = await signUp("bidder")
    await db.update(users).set({ balanceCents: 50_000 }).where(eq(users.id, id))
    const auctioneer = await createUser({ role: "auctioneer" })
    const now = new Date()
    const lot = await createLot(auctioneer.id, {
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
    })
    await placeBid({ lotId: lot.id, bidderId: id, amountCents: 12_000 })

    expect((await getWallet(cookies)).json()).toEqual({
      balanceCents: 50_000,
      committedCents: 12_000,
      availableCents: 38_000,
    })

    const rival = await createUser({ balanceCents: 100_000 })
    await placeBid({ lotId: lot.id, bidderId: rival.id, amountCents: 12_500 })

    expect((await getWallet(cookies)).json()).toEqual({
      balanceCents: 50_000,
      committedCents: 0,
      availableCents: 50_000,
    })
  })
})

describe("POST /api/wallet/deposits", () => {
  it("soma o valor ao saldo", async () => {
    const { cookies } = await signUp("bidder")
    const first = await postDeposit(cookies, { amountCents: 25_000 })
    expect(first.statusCode).toBe(201)
    expect(first.json().balanceCents).toBe(25_000)

    const second = await postDeposit(cookies, { amountCents: 5_000 })
    expect(second.json()).toEqual({
      balanceCents: 30_000,
      committedCents: 0,
      availableCents: 30_000,
    })
  })

  it("aceita o valor máximo e recusa acima dele", async () => {
    const { cookies } = await signUp("bidder")
    expect(
      (await postDeposit(cookies, { amountCents: MAX_DEPOSIT_CENTS }))
        .statusCode,
    ).toBe(201)
    expect(
      (await postDeposit(cookies, { amountCents: MAX_DEPOSIT_CENTS + 1 }))
        .statusCode,
    ).toBe(400)
  })

  it.each([0, -100, 10.5, "100", null])("recusa o valor %s", async (amount) => {
    const { cookies } = await signUp("bidder")
    const response = await postDeposit(cookies, { amountCents: amount })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("é só para licitantes", async () => {
    const { cookies } = await signUp("auctioneer")
    expect(
      (await postDeposit(cookies, { amountCents: 1_000 })).statusCode,
    ).toBe(403)
  })

  it("não perde depósitos simultâneos", async () => {
    const user = await createUser()
    await Promise.all(Array.from({ length: 10 }, () => deposit(user.id, 100)))
    const [saved] = await db.select().from(users).where(eq(users.id, user.id))
    expect(saved.balanceCents).toBe(1_000)
  })
})
