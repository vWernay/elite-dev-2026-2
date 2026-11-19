import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { resetDb } from "../test/factories.js"
import { createAccount } from "./accounts.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const register = (payload: object) =>
  app.inject({ method: "POST", url: "/api/auth/register", payload })

const base = { name: "Ana", email: "ana@teste.com", password: "senha12345" }

describe("POST /api/auth/register", () => {
  it("cria o usuário como licitante", async () => {
    const response = await register(base)
    expect(response.statusCode).toBe(201)
    expect(response.json().role).toBe("bidder")
  })

  it("ignora o papel enviado no corpo: leiloeiro nasce licitante", async () => {
    const response = await register({ ...base, role: "auctioneer" })
    expect(response.statusCode).toBe(201)
    expect(response.json().role).toBe("bidder")

    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, base.email))
    expect(row.role).toBe("bidder")
  })

  it("o usuário criado assim não acessa rotas de leiloeiro", async () => {
    const response = await register({ ...base, role: "auctioneer" })
    const token = response.cookies.find((c) => c.name === "token")?.value
    const lots = await app.inject({
      method: "GET",
      url: "/api/auctioneer/lots",
      cookies: { token: token ?? "" },
    })
    expect(lots.statusCode).toBe(403)
  })
})

describe("createAccount (script user:create)", () => {
  it("cria leiloeiro com a senha com hash", async () => {
    const user = await createAccount({
      name: "Casa de Leilões",
      email: "  Casa@Leiloes.com ",
      password: "senha12345",
      role: "auctioneer",
    })
    expect(user.role).toBe("auctioneer")
    expect(user.email).toBe("casa@leiloes.com")

    const [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row.passwordHash).not.toContain("senha12345")

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "casa@leiloes.com", password: "senha12345" },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().role).toBe("auctioneer")
  })

  it("recusa senha curta e papel inválido", async () => {
    const input = {
      name: "X",
      email: "x@x.com",
      password: "curta",
      role: "auctioneer" as const,
    }
    await expect(createAccount(input)).rejects.toThrow()
    await expect(
      createAccount({
        ...input,
        password: "senha12345",
        role: "admin" as never,
      }),
    ).rejects.toThrow()
  })
})
