import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"

const html = { accept: "text/html,application/xhtml+xml" }
let dir: string
let withSite: ReturnType<typeof buildApp>
let apiOnly: ReturnType<typeof buildApp>

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "web-"))
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>site</title>")
  writeFileSync(join(dir, "favicon.svg"), "<svg/>")
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)")

  withSite = buildApp({ webDir: dir })
  apiOnly = buildApp()
  await Promise.all([withSite.ready(), apiOnly.ready()])
})

afterAll(async () => {
  await Promise.all([withSite.close(), apiOnly.close()])
  rmSync(dir, { recursive: true, force: true })
})

const get = (url: string, headers: Record<string, string> = {}) =>
  withSite.inject({ method: "GET", url, headers })

describe("site servido pela API", () => {
  it("serve o index.html na raiz, sem cache", async () => {
    const response = await get("/", html)
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain("<title>site</title>")
    expect(response.headers["cache-control"]).toBe("no-cache")
  })

  it("arquivos com hash em /assets/ ficam em cache para sempre", async () => {
    const response = await get("/assets/app-abc123.js")
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  it("arquivos sem hash são sempre revalidados", async () => {
    const response = await get("/favicon.svg")
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-cache")
  })

  it("endereços do site caem no index.html (rotas do React)", async () => {
    for (const url of ["/lotes/abc", "/entrar", "/?status=ended&page=2"]) {
      const response = await get(url, html)
      expect(response.statusCode, url).toBe(200)
      expect(response.body, url).toContain("<title>site</title>")
    }
  })

  it("a API continua respondendo e rotas /api desconhecidas dão 404 em JSON", async () => {
    const health = await get("/api/health", html)
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: "ok" })

    const missing = await get("/api/nao-existe", html)
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe("NOT_FOUND")
  })

  it("quem não pede página recebe 404 em JSON, não o index.html", async () => {
    const response = await get("/lotes/abc", { accept: "application/json" })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe("NOT_FOUND")
  })

  it("só o GET cai no index.html", async () => {
    const response = await withSite.inject({
      method: "POST",
      url: "/lotes/abc",
      headers: html,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe("NOT_FOUND")
  })

  it("não entrega arquivos de fora da pasta do site", async () => {
    for (const url of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/..%2fpackage.json",
    ]) {
      const response = await get(url)
      expect(response.body, url).not.toContain('"name"')
    }
  })

  it("sem a pasta do site, a raiz continua sendo 404 em JSON", async () => {
    const response = await apiOnly.inject({
      method: "GET",
      url: "/",
      headers: html,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe("NOT_FOUND")
  })
})
