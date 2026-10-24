import { eq } from "drizzle-orm"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { buildApp } from "../app.js"
import { chain } from "../audit/index.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { bids, lots } from "../db/schema.js"
import { cancelLot } from "../lots/service.js"
import { settleLot } from "../settlement/service.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { openStream } from "../test/sse.js"
import { lotEvents } from "./bus.js"

const app = buildApp({ sseHeartbeatMs: 40 })
let baseUrl = ""
const open: Awaited<ReturnType<typeof openStream>>[] = []

beforeAll(async () => {
  await app.listen({ port: 0, host: "127.0.0.1" })
  const address = app.server.address()
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`
  }
})
afterAll(() => app.close())
beforeEach(resetDb)
afterEach(() => {
  for (const stream of open.splice(0)) stream.close()
})

async function stream(lotId: string) {
  const s = await openStream(`${baseUrl}/api/lots/${lotId}/events`)
  open.push(s)
  return s
}

const inLot = (minutesIn: number) => () => addMs(T0, minutes(minutesIn))

async function setup() {
  const auctioneer = await createUser({ role: "auctioneer" })
  const ana = await createUser({
    name: "Ana Secreta",
    email: "ana.secreta@teste.com",
    balanceCents: 100_000,
  })
  const bruno = await createUser({ balanceCents: 100_000 })
  const lot = await createLot(auctioneer.id)
  const bid = (user: { id: string }, amountCents: number, at = 10) =>
    placeBid({ lotId: lot.id, bidderId: user.id, amountCents }, inLot(at))
  return { auctioneer, ana, bruno, lot, bid }
}

describe("GET /api/lots/:id/events: conexão", () => {
  it("abre um stream SSE e confirma a conexão", async () => {
    const { lot } = await setup()
    const s = await stream(lot.id)

    expect(s.response.status).toBe(200)
    expect(s.response.headers.get("content-type")).toBe("text/event-stream")
    expect(s.response.headers.get("cache-control")).toContain("no-cache")
    expect(s.response.headers.get("x-accel-buffering")).toBe("no")
    expect(await s.waitFor(() => s.comments.includes(": connected"))).toBe(true)
  })

  it("é público: não pede login", async () => {
    const { lot } = await setup()
    expect((await stream(lot.id)).response.status).toBe(200)
  })

  it("responde 404 e 400 sem abrir stream", async () => {
    const missing = await fetch(
      `${baseUrl}/api/lots/00000000-0000-4000-8000-000000000000/events`,
    )
    expect(missing.status).toBe(404)
    const body = (await missing.json()) as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")

    const invalid = await fetch(`${baseUrl}/api/lots/nao-e-uuid/events`)
    expect(invalid.status).toBe(400)
  })

  it("manda um ping periodico para o proxy não fechar a conexão", async () => {
    const { lot } = await setup()
    const s = await stream(lot.id)
    expect(
      await s.waitFor(
        () => s.comments.filter((c) => c === ": ping").length >= 2,
      ),
    ).toBe(true)
  })

  it("para de assinar quando o cliente desconecta", async () => {
    const { lot } = await setup()
    const s = await stream(lot.id)
    expect(lotEvents.count(lot.id)).toBe(1)

    s.close()

    const gone = await s.waitFor(() => lotEvents.count(lot.id) === 0)
    expect(gone).toBe(true)
  })

  it("encerra os streams quando o servidor é desligado", async () => {
    const other = buildApp({ sseHeartbeatMs: 40 })
    await other.listen({ port: 0, host: "127.0.0.1" })
    const address = other.server.address()
    const port = address && typeof address === "object" ? address.port : 0
    const { lot } = await setup()

    const s = await openStream(
      `http://127.0.0.1:${port}/api/lots/${lot.id}/events`,
    )
    open.push(s)
    await other.close()

    expect(await s.waitFor(() => s.ended)).toBe(true)
    expect(lotEvents.count(lot.id)).toBe(0)
  })
})

describe("evento bid", () => {
  it("chega com o lance e o próximo mínimo", async () => {
    const { lot, ana, bid } = await setup()
    const s = await stream(lot.id)

    await bid(ana, 10_000, 10)

    expect(await s.waitForEvents(1)).toBe(true)
    expect(s.events[0]).toEqual({
      event: "bid",
      data: {
        seq: 1,
        pseudonym: chain.pseudonym(lot.id, ana.id),
        amountCents: 10_000,
        createdAt: addMs(T0, minutes(10)).toISOString(),
        minNextBidCents: 10_500,
        endsAt: addMs(T0, minutes(60)).toISOString(),
      },
    })
  })

  it("traz o novo fim quando o anti-sniping prorroga", async () => {
    const { lot, ana, bid } = await setup()
    const s = await stream(lot.id)

    await bid(ana, 10_000, 59)

    await s.waitForEvents(1)
    expect((s.events[0].data as { endsAt: string }).endsAt).toBe(
      addMs(T0, minutes(61)).toISOString(),
    )
  })

  it("não expõe dados do licitante", async () => {
    const { lot, ana, bid } = await setup()
    const s = await stream(lot.id)
    await bid(ana, 10_000)
    await s.waitForEvents(1)

    const raw = JSON.stringify(s.events)
    expect(raw).not.toContain("Ana Secreta")
    expect(raw).not.toContain("ana.secreta")
    expect(raw).not.toContain(ana.id)
  })

  it("chega só para quem está no lote certo", async () => {
    const { lot, auctioneer, ana, bid } = await setup()
    const otherLot = await createLot(auctioneer.id)
    const here = await stream(lot.id)
    const elsewhere = await stream(otherLot.id)

    await bid(ana, 10_000)
    await here.waitForEvents(1)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(here.events).toHaveLength(1)
    expect(elsewhere.events).toHaveLength(0)
  })

  it("chega para todos os espectadores", async () => {
    const { lot, ana, bid } = await setup()
    const viewers = await Promise.all([
      stream(lot.id),
      stream(lot.id),
      stream(lot.id),
    ])

    await bid(ana, 10_000)

    for (const viewer of viewers)
      expect(await viewer.waitForEvents(1)).toBe(true)
  })

  it("mantém a ordem dos lances", async () => {
    const { lot, ana, bruno, bid } = await setup()
    const s = await stream(lot.id)

    await bid(ana, 10_000, 10)
    await bid(bruno, 10_500, 20)
    await bid(ana, 11_000, 30)

    await s.waitForEvents(3)
    expect(s.events.map((e) => (e.data as { seq: number }).seq)).toEqual([
      1, 2, 3,
    ])
    expect(
      s.events.map((e) => (e.data as { amountCents: number }).amountCents),
    ).toEqual([10_000, 10_500, 11_000])
  })

  it("só sai depois do commit: o lance já está gravado quando o evento chega", async () => {
    const { lot, ana, bid } = await setup()
    let savedWhenNotified: number | null = null
    const unsubscribe = lotEvents.subscribe(lot.id, () => {
      // roda no mesmo tick da publicação; a consulta abaixo é feita logo depois
      void db
        .select()
        .from(bids)
        .where(eq(bids.lotId, lot.id))
        .then((rows) => {
          savedWhenNotified = rows.length
        })
    })

    await bid(ana, 10_000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    unsubscribe()

    expect(savedWhenNotified).toBe(1)
  })

  it("lance recusado não gera evento", async () => {
    const { lot, ana, bid } = await setup()
    const s = await stream(lot.id)

    await expect(bid(ana, 1)).rejects.toMatchObject({
      code: "BID_BELOW_MINIMUM",
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(s.events).toHaveLength(0)
  })

  it("um espectador com problema não derruba o lance nem os outros", async () => {
    const { lot, ana, bid } = await setup()
    const s = await stream(lot.id)
    const unsubscribe = lotEvents.subscribe(lot.id, () => {
      throw new Error("conexão quebrada")
    })

    await expect(bid(ana, 10_000)).resolves.toMatchObject({ bid: { seq: 1 } })
    expect(await s.waitForEvents(1)).toBe(true)
    unsubscribe()
  })
})

describe("evento cancelled", () => {
  it("chega quando o leiloeiro cancela", async () => {
    const { lot, auctioneer } = await setup()
    const s = await stream(lot.id)

    await cancelLot(lot.id, auctioneer.id)

    expect(await s.waitForEvents(1)).toBe(true)
    expect(s.events[0]).toEqual({ event: "cancelled", data: {} })
  })

  it("cancelar de novo não repete o evento", async () => {
    const { lot, auctioneer } = await setup()
    const s = await stream(lot.id)

    await cancelLot(lot.id, auctioneer.id)
    await s.waitForEvents(1)
    await cancelLot(lot.id, auctioneer.id)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(s.events).toHaveLength(1)
  })

  it("cancelamento recusado não gera evento", async () => {
    const { lot, auctioneer, ana, bid } = await setup()
    await bid(ana, 10_000)
    const s = await stream(lot.id)

    await expect(cancelLot(lot.id, auctioneer.id)).rejects.toMatchObject({
      code: "LOT_HAS_BIDS",
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(s.events).toHaveLength(0)
  })
})

describe("evento settled", () => {
  it("chega com o comprovante e o pseudônimo do vencedor", async () => {
    const { lot, bruno, bid, ana } = await setup()
    await bid(ana, 10_000, 10)
    await bid(bruno, 12_000, 20)
    const s = await stream(lot.id)

    const result = await settleLot(lot.id, inLot(61))
    if (result.outcome !== "sold") throw new Error("não liquidou")

    expect(await s.waitForEvents(1)).toBe(true)
    expect(s.events[0]).toEqual({
      event: "settled",
      data: {
        receiptId: result.receiptId,
        winnerPseudonym: chain.pseudonym(lot.id, bruno.id),
      },
    })
  })

  it("lote sem lances encerra sem comprovante e sem vencedor", async () => {
    const { lot } = await setup()
    const s = await stream(lot.id)

    await settleLot(lot.id, inLot(61))

    await s.waitForEvents(1)
    expect(s.events[0]).toEqual({
      event: "settled",
      data: { receiptId: null, winnerPseudonym: null },
    })
  })

  it("não avisa quando o lote é pulado ou está adulterado", async () => {
    const { lot, ana, bid } = await setup()
    await bid(ana, 10_000)
    const s = await stream(lot.id)

    await settleLot(lot.id, inLot(30)) // ainda não terminou
    await db.update(lots).set({ currentBidCents: 1 }).where(eq(lots.id, lot.id))
    await settleLot(lot.id, inLot(61)) // adulterado
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(s.events).toHaveLength(0)
  })

  it("liquidar de novo não repete o evento", async () => {
    const { lot, ana, bid } = await setup()
    await bid(ana, 10_000)
    const s = await stream(lot.id)

    await settleLot(lot.id, inLot(61))
    await s.waitForEvents(1)
    await settleLot(lot.id, inLot(61))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(s.events).toHaveLength(1)
  })
})
