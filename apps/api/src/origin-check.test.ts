import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())

// Passar da checagem de origem aqui significa chegar ao login e levar 401
const post = (headers: Record<string, string>) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "ninguem@teste.com", password: "qualquer-senha" },
    headers: { host: "mesa.example.com", ...headers },
  })

describe("checagem do header Origin", () => {
  it("recusa POST com Origin de outro site", async () => {
    const response = await post({ origin: "https://site-malicioso.example" })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe("FORBIDDEN_ORIGIN")
  })

  it("recusa Origin 'null' e Origin inválido", async () => {
    expect((await post({ origin: "null" })).statusCode).toBe(403)
    expect((await post({ origin: "lixo" })).statusCode).toBe(403)
  })

  it("recusa outro subdomínio e outra porta", async () => {
    expect(
      (await post({ origin: "https://evil.mesa.example.com" })).statusCode,
    ).toBe(403)
    expect(
      (await post({ origin: "https://mesa.example.com:8443" })).statusCode,
    ).toBe(403)
  })

  it("aceita POST com Origin do próprio site", async () => {
    const response = await post({ origin: "https://mesa.example.com" })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS")
  })

  it("aceita POST sem Origin (curl, outros clientes)", async () => {
    expect((await post({})).statusCode).toBe(401)
  })

  it("não barra GET, mesmo com Origin de fora", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "mesa.example.com", origin: "https://outro.example" },
    })
    expect(response.statusCode).toBe(200)
  })

  it("vale também para PUT, PATCH e DELETE", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: "/api/lots/x",
        headers: { host: "mesa.example.com", origin: "https://outro.example" },
      })
      expect(response.statusCode).toBe(403)
    }
  })
})
