import { describe, expect, it, vi } from "vitest"
import { createScryfallClient } from "./scryfall.js"

const bolt = {
  id: "f58dba4f-1abb-47a3-a684-29c32bab95c0",
  name: "Lightning Bolt",
  set_name: "Secrets of Strixhaven",
  rarity: "mythic",
  artist: "Alix Branwyn",
  type_line: "Instant",
  released_at: "2026-04-24",
  prices: { usd: "2.37", eur: null },
  image_uris: { normal: "https://cards.scryfall.io/normal/front/bolt.jpg" },
}

const delver = {
  id: "6904ea20-e504-47da-95a0-08739fdde260",
  name: "Delver of Secrets // Insectile Aberration",
  set_name: "Innistrad",
  rarity: "common",
  type_line: "Creature — Human Wizard",
  released_at: "2011-09-30",
  card_faces: [
    {
      artist: "Nils Hamm",
      image_uris: {
        normal: "https://cards.scryfall.io/normal/front/delver.jpg",
      },
    },
    { artist: "Nils Hamm" },
  ],
}

const noImage = { ...bolt, id: "sem-imagem", image_uris: undefined }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const searchBody = (data: unknown[]) => ({
  object: "list",
  total_cards: data.length,
  has_more: false,
  data,
})

function setup(responses: Array<() => Response | Promise<Response>>) {
  const queue = [...responses]
  const fetchFn = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error("fetch inesperado")
    return next()
  })
  let time = 0
  const client = createScryfallClient({
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => time,
    minIntervalMs: 0,
    ttlMs: 1_000,
  })
  return { client, fetchFn, advance: (ms: number) => (time += ms) }
}

describe("searchCards", () => {
  it("envia User-Agent e Accept e codifica a busca", async () => {
    const { client, fetchFn } = setup([() => json(searchBody([bolt]))])
    await client.searchCards("lightning bolt & co", 2)

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe("/cards/search")
    expect(parsed.searchParams.get("q")).toBe("lightning bolt & co")
    expect(parsed.searchParams.get("page")).toBe("2")
    const headers = init.headers as Record<string, string>
    expect(headers["User-Agent"]).toBeTruthy()
    expect(headers.Accept).toBeTruthy()
  })

  it("normaliza os campos da carta", async () => {
    const { client } = setup([() => json(searchBody([bolt]))])
    const result = await client.searchCards("bolt")
    expect(result).toEqual({
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
          refPriceEur: null,
        },
      ],
      hasMore: false,
      total: 1,
    })
  })

  it("pega imagem e artista da primeira face nas cartas de duas faces", async () => {
    const { client } = setup([() => json(searchBody([delver]))])
    const [card] = (await client.searchCards("delver")).cards
    expect(card.imageUrl).toBe(
      "https://cards.scryfall.io/normal/front/delver.jpg",
    )
    expect(card.artist).toBe("Nils Hamm")
    expect(card.refPriceUsd).toBeNull()
  })

  it("ignora cartas sem imagem", async () => {
    const { client } = setup([() => json(searchBody([noImage, bolt]))])
    const result = await client.searchCards("bolt")
    expect(result.cards.map((c) => c.name)).toEqual(["Lightning Bolt"])
  })

  it("devolve lista vazia quando não há resultado", async () => {
    const { client } = setup([() => json({ object: "error" }, 404)])
    expect(await client.searchCards("zzzz")).toEqual({
      cards: [],
      hasMore: false,
      total: 0,
    })
  })

  it.each([429, 500, 503])(
    "responde indisponível quando o Scryfall dá %s",
    async (status) => {
      const { client } = setup([() => json({ object: "error" }, status)])
      await expect(client.searchCards("bolt")).rejects.toMatchObject({
        status: 503,
        code: "EXTERNAL_API_UNAVAILABLE",
      })
    },
  )

  it("responde indisponível quando a rede falha ou estoura o tempo", async () => {
    const { client } = setup([
      () => {
        throw new TypeError("fetch failed")
      },
      () => {
        throw new DOMException("timeout", "TimeoutError")
      },
    ])
    await expect(client.searchCards("a1")).rejects.toMatchObject({
      code: "EXTERNAL_API_UNAVAILABLE",
    })
    await expect(client.searchCards("a2")).rejects.toMatchObject({
      code: "EXTERNAL_API_UNAVAILABLE",
    })
  })

  it("responde indisponível quando o corpo não é JSON", async () => {
    const { client } = setup([() => new Response("<html>", { status: 200 })])
    await expect(client.searchCards("bolt")).rejects.toMatchObject({
      code: "EXTERNAL_API_UNAVAILABLE",
    })
  })
})

describe("cache", () => {
  it("não repete a chamada enquanto o cache vale", async () => {
    const { client, fetchFn, advance } = setup([() => json(searchBody([bolt]))])
    await client.searchCards("Bolt")
    advance(999)
    await client.searchCards("bolt")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("busca de novo depois que o cache vence", async () => {
    const { client, fetchFn, advance } = setup([
      () => json(searchBody([bolt])),
      () => json(searchBody([bolt])),
    ])
    await client.searchCards("bolt")
    advance(1_001)
    await client.searchCards("bolt")
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("usa o cache vencido quando o Scryfall cai", async () => {
    const { client, advance } = setup([
      () => json(searchBody([bolt])),
      () => json({}, 500),
    ])
    const first = await client.searchCards("bolt")
    advance(5_000)
    expect(await client.searchCards("bolt")).toEqual(first)
  })

  it("não guarda erro no cache", async () => {
    const { client, fetchFn } = setup([
      () => json({}, 500),
      () => json(searchBody([bolt])),
    ])
    await expect(client.searchCards("bolt")).rejects.toBeTruthy()
    expect((await client.searchCards("bolt")).cards).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe("getCard", () => {
  it("busca a carta pelo id e normaliza", async () => {
    const { client, fetchFn } = setup([() => json(delver)])
    const card = await client.getCard(delver.id)
    expect(card.scryfallId).toBe(delver.id)
    const [url] = fetchFn.mock.calls[0] as unknown as [string]
    expect(url).toBe(`https://api.scryfall.com/cards/${delver.id}`)
  })

  it("responde 404 para id desconhecido", async () => {
    const { client } = setup([() => json({ object: "error" }, 404)])
    await expect(client.getCard("nao-existe")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    })
  })

  it("responde indisponível quando o Scryfall cai", async () => {
    const { client } = setup([() => json({}, 503)])
    await expect(client.getCard(bolt.id)).rejects.toMatchObject({
      code: "EXTERNAL_API_UNAVAILABLE",
    })
  })
})

describe("limite de requisições", () => {
  it("espaça as chamadas pelo intervalo mínimo", async () => {
    const fetchFn = vi.fn(async () => json(searchBody([bolt])))
    const client = createScryfallClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      minIntervalMs: 40,
    })
    const start = Date.now()
    await Promise.all([
      client.searchCards("a1"),
      client.searchCards("a2"),
      client.searchCards("a3"),
    ])
    expect(Date.now() - start).toBeGreaterThanOrEqual(75)
  })
})
