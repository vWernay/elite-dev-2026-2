import { AppError } from "../errors.js"

const BASE_URL = "https://api.scryfall.com"
const HEADERS = {
  "User-Agent": "MesaDeLances/1.0",
  Accept: "application/json;q=0.9,*/*;q=0.8",
}

export type Card = {
  scryfallId: string
  name: string
  imageUrl: string
  set: string
  rarity: string
  artist: string | null
  typeLine: string
  releasedAt: string
  refPriceUsd: string | null
  refPriceEur: string | null
}

export type CardSearch = { cards: Card[]; hasMore: boolean; total: number }

type Options = {
  fetchFn?: typeof fetch
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
  minIntervalMs?: number
  maxCacheEntries?: number
}

type ScryfallFace = { image_uris?: { normal?: string }; artist?: string }
type ScryfallCard = ScryfallFace & {
  id: string
  name: string
  set_name: string
  rarity: string
  type_line: string
  released_at: string
  prices?: { usd?: string | null; eur?: string | null }
  card_faces?: ScryfallFace[]
}

const unavailable = () =>
  new AppError(
    503,
    "EXTERNAL_API_UNAVAILABLE",
    "A busca de cartas está indisponível no momento. Tente novamente em instantes.",
  )

// Cartas de duas faces não têm image_uris no topo
function normalize(raw: ScryfallCard): Card | null {
  const face = raw.card_faces?.[0]
  const imageUrl = raw.image_uris?.normal ?? face?.image_uris?.normal
  if (!imageUrl) return null
  return {
    scryfallId: raw.id,
    name: raw.name,
    imageUrl,
    set: raw.set_name,
    rarity: raw.rarity,
    artist: raw.artist ?? face?.artist ?? null,
    typeLine: raw.type_line,
    releasedAt: raw.released_at,
    refPriceUsd: raw.prices?.usd ?? null,
    refPriceEur: raw.prices?.eur ?? null,
  }
}

export function createScryfallClient(options: Options = {}) {
  const {
    fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
    now = Date.now,
    ttlMs = 10 * 60_000,
    timeoutMs = 5_000,
    minIntervalMs = 100,
    maxCacheEntries = 500,
  } = options

  const cache = new Map<string, { value: unknown; expiresAt: number }>()
  let nextSlot = 0

  async function throttle() {
    const wait = Math.max(0, nextSlot - Date.now())
    nextSlot = Math.max(nextSlot, Date.now()) + minIntervalMs
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }

  function remember(key: string, value: unknown) {
    cache.delete(key)
    cache.set(key, { value, expiresAt: now() + ttlMs })
    if (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  // Devolve null quando o Scryfall responde 404/400
  async function request(path: string): Promise<unknown | null> {
    await throttle()
    let response: Response
    try {
      response = await fetchFn(`${BASE_URL}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw unavailable()
    }
    if (response.status === 404 || response.status === 400) return null
    if (!response.ok) throw unavailable()
    try {
      return await response.json()
    } catch {
      throw unavailable()
    }
  }

  // Usa o cache enquanto vale; se a API falhar, serve o que tiver guardado
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && hit.expiresAt > now()) return hit.value as T
    try {
      const value = await load()
      remember(key, value)
      return value
    } catch (err) {
      if (hit) return hit.value as T
      throw err
    }
  }

  function searchCards(query: string, page = 1) {
    return cached<CardSearch>(
      `search:${query.toLowerCase()}:${page}`,
      async () => {
        const params = new URLSearchParams({ q: query, page: String(page) })
        const body = (await request(`/cards/search?${params}`)) as {
          data: ScryfallCard[]
          has_more: boolean
          total_cards: number
        } | null
        if (!body) return { cards: [], hasMore: false, total: 0 }
        const cards = body.data
          .map(normalize)
          .filter((c): c is Card => c !== null)
        return { cards, hasMore: body.has_more, total: body.total_cards }
      },
    )
  }

  function getCard(scryfallId: string) {
    return cached<Card>(`card:${scryfallId}`, async () => {
      const body = (await request(
        `/cards/${encodeURIComponent(scryfallId)}`,
      )) as ScryfallCard | null
      const card = body && normalize(body)
      if (!card) throw new AppError(404, "NOT_FOUND", "Carta não encontrada.")
      return card
    })
  }

  return { searchCards, getCard }
}

export const scryfall = createScryfallClient()
