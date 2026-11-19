import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"

let app: ReturnType<typeof buildApp>

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(() => app.close())

const get = (url: string) => app.inject({ method: "GET", url })

describe("headers de segurança", () => {
  it("manda nosniff, frame e referrer nas respostas da API", async () => {
    const { headers } = await get("/api/health")
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN")
    expect(headers["referrer-policy"]).toBe("no-referrer")
  })

  it("manda a CSP com imagens só do site e da Scryfall", async () => {
    const csp = (await get("/api/health")).headers[
      "content-security-policy"
    ] as string
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self' https://cards.scryfall.io data:")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it("não manda HSTS fora de produção", async () => {
    const { headers } = await get("/api/health")
    expect(headers["strict-transport-security"]).toBeUndefined()
  })

  it("também vale para respostas de erro", async () => {
    const response = await get("/api/nao-existe")
    expect(response.statusCode).toBe(404)
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("a UI do Swagger continua carregando", async () => {
    const response = await get("/api/docs/")
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    )
  })
})
