import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { db } from "../db/client.js"
import { sessions, users } from "../db/schema.js"
import { resetDb } from "../test/factories.js"
import { SESSION_COOKIE } from "./sessions.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const credentials = {
  name: "Ana",
  email: "ana@teste.com",
  password: "senha12345",
  role: "bidder",
}

const post = (url: string, payload?: object, token?: string) =>
  app.inject({
    method: "POST",
    url,
    payload,
    cookies: token ? { [SESSION_COOKIE]: token } : undefined,
  })

const me = (token?: string) =>
  app.inject({
    method: "GET",
    url: "/api/auth/me",
    cookies: token ? { [SESSION_COOKIE]: token } : undefined,
  })

const tokenOf = (response: Awaited<ReturnType<typeof post>>) =>
  response.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? ""

async function signUpAndLogin() {
  await post("/api/auth/register", credentials)
  const login = await post("/api/auth/login", {
    email: credentials.email,
    password: credentials.password,
  })
  return tokenOf(login)
}

describe("sessões no servidor", () => {
  it("o cadastro abre uma sessão com cookie HttpOnly e SameSite=Lax", async () => {
    const response = await post("/api/auth/register", credentials)
    expect(response.statusCode).toBe(201)
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe("Lax")
    expect(cookie?.path).toBe("/")
    expect((await me(cookie?.value)).statusCode).toBe(200)
  })

  it("o banco guarda só o hash do token, nunca o valor do cookie", async () => {
    const token = await signUpAndLogin()
    const rows = await db.select().from(sessions)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.id === token)).toBe(false)
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.id))).toBe(true)
  })

  it("o logout revoga a sessão: o mesmo cookie volta a dar 401", async () => {
    const token = await signUpAndLogin()
    expect((await me(token)).statusCode).toBe(200)

    const logout = await post("/api/auth/logout", undefined, token)
    expect(logout.statusCode).toBe(204)

    const after = await me(token)
    expect(after.statusCode).toBe(401)
    expect(after.json().error.code).toBe("UNAUTHENTICATED")

    const rows = await db.select().from(sessions)
    expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1)
  })

  it("o logout de uma sessão não derruba as outras do mesmo usuário", async () => {
    const first = await signUpAndLogin()
    const second = tokenOf(
      await post("/api/auth/login", {
        email: credentials.email,
        password: credentials.password,
      }),
    )
    await post("/api/auth/logout", undefined, first)
    expect((await me(first)).statusCode).toBe(401)
    expect((await me(second)).statusCode).toBe(200)
  })

  it("sair sem sessão também responde 204", async () => {
    expect((await post("/api/auth/logout")).statusCode).toBe(204)
    expect((await post("/api/auth/logout", undefined, "lixo")).statusCode).toBe(
      204,
    )
  })

  it("recusa sessão vencida", async () => {
    const token = await signUpAndLogin()
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) })
    expect((await me(token)).statusCode).toBe(401)
  })

  it("recusa token inventado ou alterado", async () => {
    const token = await signUpAndLogin()
    expect((await me("lixo")).statusCode).toBe(401)
    expect((await me(`${token}x`)).statusCode).toBe(401)
    expect((await me()).statusCode).toBe(401)
  })

  it("o papel vem do banco, não do cookie", async () => {
    const token = await signUpAndLogin()
    await db.update(users).set({ role: "auctioneer" })
    expect((await me(token)).json().role).toBe("auctioneer")
  })

  it("o login com senha errada não abre sessão", async () => {
    await post("/api/auth/register", credentials)
    const response = await post("/api/auth/login", {
      email: credentials.email,
      password: "errada-errada",
    })
    expect(response.statusCode).toBe(401)
    expect(tokenOf(response)).toBe("")
    // só a sessão aberta pelo cadastro
    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it("apaga as sessões vencidas do usuário no próximo login", async () => {
    const token = await signUpAndLogin()
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) })
    await signUpAndLoginAgain()
    const rows = await db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)
  })
})

async function signUpAndLoginAgain() {
  const login = await post("/api/auth/login", {
    email: credentials.email,
    password: credentials.password,
  })
  return tokenOf(login)
}

describe("usuário removido", () => {
  it("a sessão some junto com o usuário", async () => {
    await signUpAndLogin()
    await db.delete(users).where(eq(users.email, credentials.email))
    expect(await db.select().from(sessions)).toHaveLength(0)
  })
})
