import { asc, eq } from "drizzle-orm"
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
import { chain } from "../audit/index.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { bids, lots, receipts, users } from "../db/schema.js"
import { settleLot } from "../settlement/service.js"
import { signUp as register } from "../test/auth.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
} from "../test/factories.js"
import { cancelLot } from "./service.js"

const app = buildApp()
const signUp = (role: "bidder" | "auctioneer", email?: string) =>
  register(app, role, email)

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)
afterEach(() => vi.unstubAllGlobals())

type Cookies = { token: string }

const NOW = () => new Date()
const hours = (n: number) => n * minutes(60)

const live = (overrides = {}) => ({
  startsAt: addMs(NOW(), -hours(1)),
  endsAt: addMs(NOW(), hours(1)),
  ...overrides,
})
const scheduled = (overrides = {}) => ({
  startsAt: addMs(NOW(), hours(1)),
  endsAt: addMs(NOW(), hours(2)),
  ...overrides,
})
const ended = (overrides = {}) => ({
  startsAt: addMs(NOW(), -hours(2)),
  endsAt: addMs(NOW(), -hours(1)),
  ...overrides,
})

const cardJson = (id: string) => ({
  id,
  name: "Lightning Bolt",
  set_name: "Alpha",
  rarity: "common",
  artist: "Christopher Rush",
  type_line: "Instant",
  released_at: "1993-08-05",
  prices: { usd: "100.00", eur: null },
  image_uris: { normal: "https://cards.scryfall.io/normal/front/bolt.jpg" },
})

function stubScryfall() {
  const fetchMock = vi.fn(async (url: string) =>
    Response.json(cardJson(String(url).split("/").pop() as string)),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

let cardCounter = 0
// Cada teste usa um id novo, porque o cliente do Scryfall guarda cache.
const newCardId = () =>
  `00000000-0000-4000-8000-${String(++cardCounter).padStart(12, "0")}`

const iso = (date: Date) => date.toISOString()

const createBody = (overrides: Record<string, unknown> = {}) => ({
  scryfallId: newCardId(),
  startingBidCents: 10_000,
  minIncrementCents: 500,
  startsAt: iso(addMs(NOW(), hours(1))),
  endsAt: iso(addMs(NOW(), hours(2))),
  ...overrides,
})

const postLot = (cookies: Cookies | undefined, payload: object) =>
  app.inject({ method: "POST", url: "/api/lots", cookies, payload })

const getJson = async (url: string, cookies?: Cookies) =>
  app.inject({ method: "GET", url, cookies })

describe("POST /api/lots", () => {
  it("exige login de leiloeiro", async () => {
    expect((await postLot(undefined, createBody())).statusCode).toBe(401)
    const { cookies } = await signUp("bidder")
    expect((await postLot(cookies, createBody())).statusCode).toBe(403)
  })

  it("cria o lote com uma cópia da carta", async () => {
    stubScryfall()
    const { id, cookies } = await signUp("auctioneer")
    const body = createBody()
    const response = await postLot(cookies, body)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      title: "Lightning Bolt",
      imageUrl: "https://cards.scryfall.io/normal/front/bolt.jpg",
      status: "scheduled",
      startingBidCents: 10_000,
      minNextBidCents: 10_000,
      bidCount: 0,
      currentBidCents: null,
      attributes: {
        set: "Alpha",
        rarity: "common",
        artist: "Christopher Rush",
        refPriceUsd: "100.00",
      },
    })

    const [saved] = await db.select().from(lots)
    expect(saved.auctioneerId).toBe(id)
    expect(saved.scryfallId).toBe(body.scryfallId)
    expect(saved.originalEndsAt).toEqual(saved.endsAt)
  })

  it("grava um head_mac inicial que a auditoria aceita", async () => {
    stubScryfall()
    const { cookies } = await signUp("auctioneer")
    await postLot(cookies, createBody())

    const [saved] = await db.select().from(lots)
    expect(chain.verify(saved, []).verdict).toBe("intact")
  })

  it("aceita começar agora, com pequena tolerância", async () => {
    stubScryfall()
    const { cookies } = await signUp("auctioneer")
    const response = await postLot(
      cookies,
      createBody({ startsAt: iso(addMs(NOW(), -30_000)) }),
    )
    expect(response.statusCode).toBe(201)
    expect(response.json().status).toBe("live")
  })

  it("recusa início no passado e fim antes do início, sem chamar o Scryfall", async () => {
    const fetchMock = stubScryfall()
    const { cookies } = await signUp("auctioneer")

    const past = await postLot(
      cookies,
      createBody({ startsAt: iso(addMs(NOW(), -minutes(5))) }),
    )
    expect(past.statusCode).toBe(422)
    expect(past.json().error.code).toBe("INVALID_SCHEDULE")

    const inverted = await postLot(
      cookies,
      createBody({
        startsAt: iso(addMs(NOW(), hours(2))),
        endsAt: iso(addMs(NOW(), hours(1))),
      }),
    )
    expect(inverted.statusCode).toBe(422)
    expect(inverted.json().error.code).toBe("INVALID_SCHEDULE")

    const equal = iso(addMs(NOW(), hours(1)))
    const same = await postLot(
      cookies,
      createBody({ startsAt: equal, endsAt: equal }),
    )
    expect(same.statusCode).toBe(422)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["lance inicial zero", { startingBidCents: 0 }],
    ["incremento negativo", { minIncrementCents: -1 }],
    ["lance decimal", { startingBidCents: 10.5 }],
    ["data sem formato ISO", { startsAt: "amanhã" }],
    ["carta vazia", { scryfallId: "" }],
  ])("valida o corpo: %s", async (_name, override) => {
    const { cookies } = await signUp("auctioneer")
    const response = await postLot(cookies, createBody(override))
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("responde 503 e não cria nada quando o Scryfall está fora do ar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const { cookies } = await signUp("auctioneer")
    const response = await postLot(cookies, createBody())

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe("EXTERNAL_API_UNAVAILABLE")
    expect(await db.select().from(lots)).toHaveLength(0)
  })

  it("responde 404 para carta que não existe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    )
    const { cookies } = await signUp("auctioneer")
    const response = await postLot(cookies, createBody())
    expect(response.statusCode).toBe(404)
  })

  it("vitrine, sala e lance continuam funcionando com o Scryfall fora do ar", async () => {
    stubScryfall()
    const { cookies } = await signUp("auctioneer")
    const created = await postLot(
      cookies,
      createBody({ startsAt: iso(addMs(NOW(), -10_000)) }),
    )
    const lotId = created.json().id

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const list = await getJson("/api/lots?status=live")
    const room = await getJson(`/api/lots/${lotId}`)
    expect(list.statusCode).toBe(200)
    expect(list.json().items).toHaveLength(1)
    expect(room.statusCode).toBe(200)
    expect(room.json().title).toBe("Lightning Bolt")

    const bidder = await createUser({ balanceCents: 50_000 })
    const bid = await placeBid({
      lotId,
      bidderId: bidder.id,
      amountCents: 10_000,
    })
    expect(bid.bid.seq).toBe(1)
  })
})

describe("GET /api/lots", () => {
  async function seed() {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = (title: string, window: object, extra = {}) =>
      createLot(auctioneer.id, { title, ...window, ...extra })
    return { auctioneer, lot }
  }

  it("é público e separa ao vivo, agendados e encerrados", async () => {
    const { lot } = await seed()
    await lot("Ao vivo", live())
    await lot("Agendado", scheduled())
    await lot("Encerrado", ended())

    const titles = async (status?: string) =>
      (await getJson(`/api/lots${status ? `?status=${status}` : ""}`))
        .json()
        .items.map((i: { title: string }) => i.title)

    expect(await titles("live")).toEqual(["Ao vivo"])
    expect(await titles("scheduled")).toEqual(["Agendado"])
    expect(await titles("ended")).toEqual(["Encerrado"])
    expect((await titles()).sort()).toEqual([
      "Agendado",
      "Ao vivo",
      "Encerrado",
    ])
  })

  it("nunca mostra lotes cancelados", async () => {
    const { lot } = await seed()
    await lot("Cancelado ao vivo", live(), { cancelledAt: NOW() })
    await lot("Cancelado agendado", scheduled(), { cancelledAt: NOW() })
    await lot("Cancelado encerrado", ended(), { cancelledAt: NOW() })
    await lot("Normal", live())

    for (const status of [
      "",
      "?status=live",
      "?status=scheduled",
      "?status=ended",
    ]) {
      const items = (await getJson(`/api/lots${status}`)).json().items
      expect(items.map((i: { title: string }) => i.title)).not.toContain(
        "Cancelado ao vivo",
      )
      expect(
        items.every((i: { status: string }) => i.status !== "cancelled"),
      ).toBe(true)
    }
  })

  it("ordena ao vivo pelo fim mais próximo e encerrados pelo mais recente", async () => {
    const { lot } = await seed()
    await lot("Termina depois", live({ endsAt: addMs(NOW(), hours(3)) }))
    await lot("Termina antes", live({ endsAt: addMs(NOW(), minutes(10)) }))
    await lot(
      "Encerrou antes",
      ended({
        startsAt: addMs(NOW(), -hours(6)),
        endsAt: addMs(NOW(), -hours(5)),
      }),
    )
    await lot("Encerrou depois", ended({ endsAt: addMs(NOW(), -minutes(5)) }))

    const titles = async (status: string) =>
      (await getJson(`/api/lots?status=${status}`))
        .json()
        .items.map((i: { title: string }) => i.title)
    expect(await titles("live")).toEqual(["Termina antes", "Termina depois"])
    expect(await titles("ended")).toEqual(["Encerrou depois", "Encerrou antes"])
  })

  it("pagina e informa o total", async () => {
    const { lot } = await seed()
    for (const n of [1, 2, 3])
      await lot(`Lote ${n}`, live({ endsAt: addMs(NOW(), hours(n)) }))

    const first = (await getJson("/api/lots?status=live&limit=2")).json()
    expect(first.total).toBe(3)
    expect(first.items).toHaveLength(2)
    const second = (
      await getJson("/api/lots?status=live&limit=2&offset=2")
    ).json()
    expect(second.items.map((i: { title: string }) => i.title)).toEqual([
      "Lote 3",
    ])
  })

  it("busca por título e por coleção, sem diferenciar maiúsculas", async () => {
    const { lot } = await seed()
    await lot("Lightning Bolt", live(), { attributes: { set: "Alpha" } })
    await lot("Black Lotus", live(), { attributes: { set: "Beta" } })

    const titles = async (q: string) =>
      (await getJson(`/api/lots?q=${encodeURIComponent(q)}`))
        .json()
        .items.map((i: { title: string }) => i.title)
    expect(await titles("bolt")).toEqual(["Lightning Bolt"])
    expect(await titles("LOTUS")).toEqual(["Black Lotus"])
    expect(await titles("beta")).toEqual(["Black Lotus"])
    expect(await titles("inexistente")).toEqual([])
  })

  it("trata % e _ da busca como texto comum", async () => {
    const { lot } = await seed()
    await lot("100% Bolt", live())
    await lot("Outro", live())

    const count = async (q: string) =>
      (await getJson(`/api/lots?q=${encodeURIComponent(q)}`)).json().total
    expect(await count("100%")).toBe(1)
    expect(await count("%")).toBe(1)
    expect(await count("_")).toBe(0)
  })

  it("valida os parâmetros", async () => {
    expect((await getJson("/api/lots?status=nada")).statusCode).toBe(400)
    expect((await getJson("/api/lots?limit=0")).statusCode).toBe(400)
    expect((await getJson("/api/lots?limit=101")).statusCode).toBe(400)
    expect((await getJson("/api/lots?offset=-1")).statusCode).toBe(400)
  })
})

describe("GET /api/lots/:id", () => {
  it("é público e traz os lances só com pseudônimo", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, live())
    const bidder = await createUser({
      name: "Fulano Secreto",
      email: "fulano.secreto@teste.com",
      balanceCents: 100_000,
    })
    await placeBid({ lotId: lot.id, bidderId: bidder.id, amountCents: 10_000 })

    const response = await getJson(`/api/lots/${lot.id}`)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.bids).toEqual([
      {
        seq: 1,
        pseudonym: chain.pseudonym(lot.id, bidder.id),
        amountCents: 10_000,
        createdAt: expect.any(String),
      },
    ])
    expect(body).toMatchObject({
      status: "live",
      currentBidCents: 10_000,
      minNextBidCents: 10_500,
      bidCount: 1,
      myPseudonym: null,
    })
    expect(Date.parse(body.serverNow)).toBeGreaterThan(Date.now() - 5_000)

    const raw = response.body
    expect(raw).not.toContain("Fulano")
    expect(raw).not.toContain("fulano.secreto")
    expect(raw).not.toContain(bidder.id)
  })

  it("devolve o pseudônimo de quem está logado", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, live())
    const { id, cookies } = await signUp("bidder")

    const body = (await getJson(`/api/lots/${lot.id}`, cookies)).json()
    expect(body.myPseudonym).toBe(chain.pseudonym(lot.id, id))
  })

  it("ignora um cookie inválido em vez de recusar", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, live())
    const response = await getJson(`/api/lots/${lot.id}`, { token: "lixo" })
    expect(response.statusCode).toBe(200)
    expect(response.json().myPseudonym).toBeNull()
  })

  it("mostra o lote cancelado como cancelado", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const lot = await createLot(auctioneer.id, {
      ...live(),
      cancelledAt: NOW(),
    })
    const response = await getJson(`/api/lots/${lot.id}`)
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe("cancelled")
  })

  it("responde 404 e 400", async () => {
    const missing = await getJson(
      "/api/lots/00000000-0000-4000-8000-000000000000",
    )
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe("NOT_FOUND")
    expect((await getJson("/api/lots/nao-e-uuid")).statusCode).toBe(400)
  })
})

describe("POST /api/lots/:id/cancel", () => {
  const cancel = (id: string, cookies?: Cookies) =>
    app.inject({ method: "POST", url: `/api/lots/${id}/cancel`, cookies })

  it("cancela um lote sem lances e ele some da vitrine", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const lot = await createLot(id, live())

    const response = await cancel(lot.id, cookies)
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe("cancelled")
    expect((await getJson("/api/lots?status=live")).json().total).toBe(0)
  })

  it("depois de cancelado, o lote recusa lances", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const lot = await createLot(id, live())
    await cancel(lot.id, cookies)

    const bidder = await createUser({ balanceCents: 50_000 })
    await expect(
      placeBid({ lotId: lot.id, bidderId: bidder.id, amountCents: 10_000 }),
    ).rejects.toMatchObject({ code: "LOT_CANCELLED" })
  })

  it("é idempotente", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const lot = await createLot(id, live())
    await cancel(lot.id, cookies)
    const again = await cancel(lot.id, cookies)
    expect(again.statusCode).toBe(200)
    expect(again.json().status).toBe("cancelled")
  })

  it("com lances, exige confirmação e a mensagem diz quantos", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const lot = await createLot(id, live())
    const bidder = await createUser({ balanceCents: 50_000 })
    await placeBid({ lotId: lot.id, bidderId: bidder.id, amountCents: 10_000 })

    const response = await cancel(lot.id, cookies)
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe("LOT_HAS_BIDS")
    expect(response.json().error.message).toContain("1 lance.")
    const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
    expect(saved.cancelledAt).toBeNull()
  })

  describe("com lances e confirmação", () => {
    const cancelConfirmed = (id: string, cookies: Cookies) =>
      app.inject({
        method: "POST",
        url: `/api/lots/${id}/cancel`,
        cookies,
        payload: { confirmBids: true },
      })

    // Ana lidera o lote com R$ 150,00 e tem R$ 500,00 de saldo
    async function setup() {
      const { id, cookies } = await signUp("auctioneer")
      const lot = await createLot(id, live())
      const ana = await signUp("bidder")
      await db
        .update(users)
        .set({ balanceCents: 50_000 })
        .where(eq(users.id, ana.id))
      await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 15_000 })
      return { lot, cookies, ana }
    }

    const wallet = async (cookies: Cookies) =>
      (await getJson("/api/wallet", cookies)).json()

    it("cancela e libera o valor reservado, sem mexer no saldo", async () => {
      const { lot, cookies, ana } = await setup()
      expect((await wallet(ana.cookies)).committedCents).toBe(15_000)

      const response = await cancelConfirmed(lot.id, cookies)
      expect(response.statusCode).toBe(200)
      expect(response.json().status).toBe("cancelled")

      expect(await wallet(ana.cookies)).toMatchObject({
        balanceCents: 50_000,
        committedCents: 0,
        availableCents: 50_000,
      })
    })

    it("o lote cancelado recusa lances e não é liquidado", async () => {
      const { lot, cookies, ana } = await setup()
      await cancelConfirmed(lot.id, cookies)

      await expect(
        placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 20_000 }),
      ).rejects.toMatchObject({ code: "LOT_CANCELLED" })

      const later = addMs(new Date(), hours(3))
      expect(await settleLot(lot.id, () => later)).toMatchObject({
        outcome: "skipped",
      })
      const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
      expect(saved.settledAt).toBeNull()
      expect(await db.select().from(receipts)).toHaveLength(0)
    })

    it("o histórico de lances continua auditável", async () => {
      const { lot, cookies } = await setup()
      await cancelConfirmed(lot.id, cookies)

      const audit = await getJson(`/api/lots/${lot.id}/audit`)
      expect(audit.statusCode).toBe(200)
      expect(audit.json()).toMatchObject({
        status: "cancelled",
        verdict: "intact",
      })
      expect(audit.json().bids).toHaveLength(1)
    })

    it("outro leiloeiro não consegue cancelar", async () => {
      const { lot } = await setup()
      const other = await signUp("auctioneer", "outro@teste.com")
      const response = await cancelConfirmed(lot.id, other.cookies)
      expect(response.statusCode).toBe(403)
    })
  })

  it("recusa lote já liquidado", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const lot = await createLot(id, { ...ended(), settledAt: NOW() })
    const response = await cancel(lot.id, cookies)
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe("LOT_ALREADY_SETTLED")
  })

  it("só o dono cancela", async () => {
    const owner = await createUser({ role: "auctioneer" })
    const lot = await createLot(owner.id, live())

    const other = await signUp("auctioneer", "outro@teste.com")
    const forbidden = await cancel(lot.id, other.cookies)
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json().error.code).toBe("FORBIDDEN")

    const bidder = await signUp("bidder")
    expect((await cancel(lot.id, bidder.cookies)).statusCode).toBe(403)
    expect((await cancel(lot.id)).statusCode).toBe(401)
  })

  it("responde 404 para lote inexistente", async () => {
    const { cookies } = await signUp("auctioneer")
    const response = await cancel(
      "00000000-0000-4000-8000-000000000000",
      cookies,
    )
    expect(response.statusCode).toBe(404)
  })

  it("cancelamento e lance simultâneos: só um dos dois vale", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const bidder = await createUser({ balanceCents: 50_000 })

    for (let round = 0; round < 5; round++) {
      const lot = await createLot(auctioneer.id, live())
      const results = await Promise.allSettled([
        cancelLot(lot.id, auctioneer.id),
        placeBid({ lotId: lot.id, bidderId: bidder.id, amountCents: 10_000 }),
      ])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)

      const [saved] = await db.select().from(lots).where(eq(lots.id, lot.id))
      const rows = await db
        .select()
        .from(bids)
        .where(eq(bids.lotId, lot.id))
        .orderBy(asc(bids.seq))
      if (saved.cancelledAt) expect(rows).toHaveLength(0)
      else expect(rows).toHaveLength(1)
    }
  })
})

describe("GET /api/auctioneer/lots", () => {
  const listMine = (cookies?: Cookies) =>
    app.inject({ method: "GET", url: "/api/auctioneer/lots", cookies })

  it("exige login de leiloeiro", async () => {
    expect((await listMine()).statusCode).toBe(401)
    const { cookies } = await signUp("bidder")
    expect((await listMine(cookies)).statusCode).toBe(403)
  })

  it("lista só os lotes dele, inclusive cancelados", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const other = await createUser({ role: "auctioneer" })
    await createLot(id, { title: "Meu normal", ...live() })
    await createLot(id, {
      title: "Meu cancelado",
      ...live(),
      cancelledAt: NOW(),
    })
    await createLot(other.id, { title: "De outro", ...live() })

    const body = (await listMine(cookies)).json()
    const titles = body.lots.map((l: { title: string }) => l.title).sort()
    expect(titles).toEqual(["Meu cancelado", "Meu normal"])
    const cancelled = body.lots.find(
      (l: { title: string }) => l.title === "Meu cancelado",
    )
    expect(cancelled.status).toBe("cancelled")
  })

  it("mostra o resultado de cada lote encerrado e o total recebido", async () => {
    const { id, cookies } = await signUp("auctioneer")
    const other = await createUser({ role: "auctioneer" })
    const winner = await createUser({ balanceCents: 100_000 })

    const sold = await createLot(id, {
      title: "Vendido",
      ...ended(),
      bidCount: 2,
      settledAt: NOW(),
    })
    await createLot(id, { title: "Sem lances", ...ended() })
    await createLot(id, { title: "Aguardando", ...ended(), bidCount: 1 })
    await createLot(id, { title: "Ao vivo", ...live() })
    const foreign = await createLot(other.id, {
      ...ended(),
      bidCount: 1,
      settledAt: NOW(),
    })

    await db.insert(receipts).values([
      {
        lotId: sold.id,
        winnerId: winner.id,
        amountCents: 25_000,
        chainMac: "x",
      },
      {
        lotId: foreign.id,
        winnerId: winner.id,
        amountCents: 99_000,
        chainMac: "x",
      },
    ])

    const body = (await listMine(cookies)).json()
    const result = (title: string) =>
      body.lots.find((l: { title: string }) => l.title === title).result

    expect(result("Vendido")).toEqual({
      outcome: "sold",
      finalAmountCents: 25_000,
      receiptId: expect.any(String),
    })
    expect(result("Sem lances")).toEqual({
      outcome: "unsold",
      finalAmountCents: null,
      receiptId: null,
    })
    expect(result("Aguardando").outcome).toBe("settling")
    expect(result("Ao vivo").outcome).toBeNull()
    expect(body.totalReceivedCents).toBe(25_000)
  })

  it("começa com total zero", async () => {
    const { cookies } = await signUp("auctioneer")
    expect((await listMine(cookies)).json()).toEqual({
      lots: [],
      totalReceivedCents: 0,
    })
  })
})
