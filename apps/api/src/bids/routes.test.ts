import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { signUp as register } from "../test/auth.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
} from "../test/factories.js"

const app = buildApp()
const signUp = (role: "bidder" | "auctioneer") => register(app, role)

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

// Lote ao vivo no relógio real, já que a rota usa a hora do servidor.
async function liveLot() {
  const auctioneer = await createUser({ role: "auctioneer" })
  const now = new Date()
  return createLot(auctioneer.id, {
    startsAt: addMs(now, -minutes(10)),
    endsAt: addMs(now, minutes(60)),
  })
}

describe("POST /api/lots/:id/bids", () => {
  it("exige login", async () => {
    const lot = await liveLot()
    const response = await app.inject({
      method: "POST",
      url: `/api/lots/${lot.id}/bids`,
      payload: { amountCents: 10_000 },
    })
    expect(response.statusCode).toBe(401)
  })

  it("não deixa o leiloeiro dar lance", async () => {
    const lot = await liveLot()
    const { cookies } = await signUp("auctioneer")
    const response = await app.inject({
      method: "POST",
      url: `/api/lots/${lot.id}/bids`,
      cookies,
      payload: { amountCents: 10_000 },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe("FORBIDDEN")
  })

  it("aceita o lance do licitante", async () => {
    const lot = await liveLot()
    const { id, cookies } = await signUp("bidder")
    await db.update(users).set({ balanceCents: 50_000 }).where(eq(users.id, id))

    const response = await app.inject({
      method: "POST",
      url: `/api/lots/${lot.id}/bids`,
      cookies,
      payload: { amountCents: 10_000 },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().bid).toMatchObject({ seq: 1, amountCents: 10_000 })
    expect(response.json().lot.minNextBidCents).toBe(10_500)
  })

  it("devolve o motivo da recusa no formato padrão", async () => {
    const lot = await liveLot()
    const { cookies } = await signUp("bidder")
    const response = await app.inject({
      method: "POST",
      url: `/api/lots/${lot.id}/bids`,
      cookies,
      payload: { amountCents: 10_000 },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      details: { availableCents: 0 },
    })
  })

  it("valida o corpo da requisição", async () => {
    const lot = await liveLot()
    const { cookies } = await signUp("bidder")
    const response = await app.inject({
      method: "POST",
      url: `/api/lots/${lot.id}/bids`,
      cookies,
      payload: { amountCents: -5 },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe("VALIDATION_ERROR")
  })
})
