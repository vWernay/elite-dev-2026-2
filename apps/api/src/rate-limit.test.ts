import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"
import { signUp } from "./test/auth.js"
import { createLot, createUser, resetDb } from "./test/factories.js"

const app = buildApp({ rateLimit: true })

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

let nextIp = 10
// cada teste usa um IP próprio, porque o contador fica na memória do app
const newIp = () => `10.1.0.${nextIp++}`

const login = (ip: string, email: string, password = "errada-errada") =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: ip,
    payload: { email, password },
  })

const register = (ip: string, email: string, headers = {}) =>
  app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: ip,
    headers,
    payload: { name: "Ana", email, password: "senha12345", role: "bidder" },
  })

describe("limite de tentativas no login", () => {
  it("a 6ª tentativa no mesmo IP e e-mail recebe 429 RATE_LIMITED", async () => {
    const ip = newIp()
    for (let i = 0; i < 5; i++) {
      expect((await login(ip, "ana@teste.com")).statusCode).toBe(401)
    }
    const blocked = await login(ip, "ana@teste.com")
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe("RATE_LIMITED")
    expect(blocked.json().error.details.retryAfterSeconds).toBeGreaterThan(0)
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0)
  })

  it("o bloqueio vale mesmo com a senha certa", async () => {
    const ip = newIp()
    await register(newIp(), "ana@teste.com")
    for (let i = 0; i < 5; i++) await login(ip, "ana@teste.com")
    const blocked = await login(ip, "ana@teste.com", "senha12345")
    expect(blocked.statusCode).toBe(429)
  })

  it("outro e-mail no mesmo IP ainda tem tentativas", async () => {
    const ip = newIp()
    for (let i = 0; i < 6; i++) await login(ip, "ana@teste.com")
    expect((await login(ip, "bruno@teste.com")).statusCode).toBe(401)
  })

  it("o mesmo e-mail vindo de outro IP não é bloqueado", async () => {
    for (let i = 0; i < 6; i++) await login(newIp(), "ana@teste.com")
    expect((await login(newIp(), "ana@teste.com")).statusCode).toBe(401)
  })

  it("trocar de e-mail não escapa do limite por IP (20 por minuto)", async () => {
    const ip = newIp()
    for (let i = 0; i < 20; i++) await login(ip, `u${i}@teste.com`)
    const blocked = await login(ip, "u99@teste.com")
    expect(blocked.statusCode).toBe(429)
  })

  it("e-mail em caixa diferente conta como o mesmo", async () => {
    const ip = newIp()
    for (let i = 0; i < 5; i++) await login(ip, "ANA@teste.com")
    expect((await login(ip, "ana@teste.com")).statusCode).toBe(429)
  })
})

describe("limite de tentativas no cadastro", () => {
  it("o 6º cadastro no mesmo IP recebe 429", async () => {
    const ip = newIp()
    for (let i = 0; i < 5; i++) {
      expect((await register(ip, `u${i}@teste.com`)).statusCode).toBe(201)
    }
    const blocked = await register(ip, "u6@teste.com")
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe("RATE_LIMITED")
  })

  it("um X-Forwarded-For forjado na frente não dá um contador novo", async () => {
    // o Heroku acrescenta o IP real no fim; o que o cliente manda vem antes
    const ip = newIp()
    for (let i = 0; i < 5; i++) {
      await register(ip, `u${i}@teste.com`, {
        "x-forwarded-for": `9.9.9.${i}, 203.0.113.7`,
      })
    }
    const blocked = await register(ip, "u6@teste.com", {
      "x-forwarded-for": "8.8.8.8, 203.0.113.7",
    })
    expect(blocked.statusCode).toBe(429)
  })
})

describe("limite global e de lances", () => {
  it("passa de 300 requisições por minuto no mesmo IP e recebe 429", async () => {
    const ip = newIp()
    const get = () =>
      app.inject({ method: "GET", url: "/api/health", remoteAddress: ip })
    let last = 200
    for (let i = 0; i < 301; i++) last = (await get()).statusCode
    expect(last).toBe(429)
  })

  it("o 31º lance do mesmo usuário em um minuto recebe 429", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id)
    const bidder = await signUp(app, "bidder", "lances@teste.com")
    const bid = () =>
      app.inject({
        method: "POST",
        url: `/api/lots/${lot.id}/bids`,
        remoteAddress: newIp(),
        cookies: bidder.cookies,
        payload: { amountCents: 1 },
      })
    let last = 0
    for (let i = 0; i < 31; i++) last = (await bid()).statusCode
    // os 30 primeiros chegam à regra de lance (recusados por valor ou saldo); o 31º é barrado antes
    expect(last).toBe(429)
  })
})
