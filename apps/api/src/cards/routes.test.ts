import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { buildApp } from "../app.js"
import { signUp as register } from "../test/auth.js"
import { resetDb } from "../test/factories.js"

const app = buildApp()
const signUp = (role: "bidder" | "auctioneer") => register(app, role)

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)
afterEach(() => vi.unstubAllGlobals())

const bolt = {
  id: "f58dba4f-1abb-47a3-a684-29c32bab95c0",
  name: "Lightning Bolt",
  set_name: "Secrets of Strixhaven",
  rarity: "mythic",
  artist: "Alix Branwyn",
  type_line: "Instant",
  released_at: "2026-04-24",
  prices: { usd: "2.37", eur: "1.79" },
  image_uris: { normal: "https://cards.scryfall.io/normal/front/bolt.jpg" },
}

// Cada teste usa uma busca diferente, porque o cliente guarda cache.
const search = (q: string, cookies?: { token: string }) =>
  app.inject({ method: "GET", url: `/api/cards/search?q=${q}`, cookies })

describe("GET /api/cards/search", () => {
  it("exige login", async () => {
    expect((await search("bolt")).statusCode).toBe(401)
  })

  it("é só para leiloeiros", async () => {
    const { cookies } = await signUp("bidder")
    expect((await search("bolt", cookies)).statusCode).toBe(403)
  })

  it("valida o tamanho da busca", async () => {
    const { cookies } = await signUp("auctioneer")
    const response = await search("a", cookies)
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("devolve as cartas normalizadas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [bolt], has_more: false, total_cards: 1 }),
      ),
    )
    const { cookies } = await signUp("auctioneer")
    const response = await search("rota-ok", cookies)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      cards: [
        {
          scryfallId: bolt.id,
          name: "Lightning Bolt",
          imageUrl: "https://cards.scryfall.io/normal/front/bolt.jpg",
          set: "Secrets of Strixhaven",
          rarity: "mythic",
          artist: "Alix Branwyn",
          typeLine: "Instant",
          releasedAt: "2026-04-24",
          refPriceUsd: "2.37",
          refPriceEur: "1.79",
        },
      ],
      hasMore: false,
      total: 1,
    })
  })

  it("responde 503 quando o Scryfall está fora do ar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const { cookies } = await signUp("auctioneer")
    const response = await search("rota-fora", cookies)

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe("EXTERNAL_API_UNAVAILABLE")
  })

  it("o resto da API continua de pé com o Scryfall fora do ar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const health = await app.inject({ method: "GET", url: "/api/health" })
    expect(health.statusCode).toBe(200)
  })
})
