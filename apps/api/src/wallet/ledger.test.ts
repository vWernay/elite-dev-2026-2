import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { placeBid } from "../bids/service.js"
import { db } from "../db/client.js"
import { users, walletEntries } from "../db/schema.js"
import { settleLot } from "../settlement/service.js"
import { signUp } from "../test/auth.js"
import {
  addMs,
  createLot,
  createUser,
  minutes,
  resetDb,
  T0,
} from "../test/factories.js"
import { verifyLedger } from "./ledger.js"
import { deposit } from "./service.js"

const app = buildApp()

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(resetDb)

const entries = (cookies: { token: string }, query = "") =>
  app.inject({ method: "GET", url: `/api/wallet/entries${query}`, cookies })

const AFTER_END = () => addMs(T0, minutes(61))
const bid = (lotId: string, bidderId: string, amountCents: number, at = 10) =>
  placeBid({ lotId, bidderId, amountCents }, () => addMs(T0, minutes(at)))

describe("depósito grava no extrato", () => {
  it("cada depósito vira uma linha com o saldo depois dele", async () => {
    const { id, cookies } = await signUp(app, "bidder")
    await deposit(id, 10_000)
    await deposit(id, 2_500)

    const body = (await entries(cookies)).json()
    expect(body.total).toBe(2)
    // mais recente primeiro
    expect(body.items).toMatchObject([
      { kind: "deposit", amountCents: 2_500, balanceAfterCents: 12_500 },
      { kind: "deposit", amountCents: 10_000, balanceAfterCents: 10_000 },
    ])
  })

  it("a API de depósito também grava", async () => {
    const { cookies } = await signUp(app, "bidder")
    await app.inject({
      method: "POST",
      url: "/api/wallet/deposits",
      cookies,
      payload: { amountCents: 5_000 },
    })
    const body = (await entries(cookies)).json()
    expect(body.items[0]).toMatchObject({
      kind: "deposit",
      amountCents: 5_000,
      balanceAfterCents: 5_000,
    })
  })

  it("um depósito recusado não deixa linha", async () => {
    const { cookies } = await signUp(app, "bidder")
    await app.inject({
      method: "POST",
      url: "/api/wallet/deposits",
      cookies,
      payload: { amountCents: -1 },
    })
    expect((await entries(cookies)).json().total).toBe(0)
  })
})

describe("liquidação grava débito e crédito", () => {
  async function soldLot() {
    const auctioneer = await signUp(app, "auctioneer")
    const winner = await signUp(app, "bidder", "ganhador@teste.com")
    await deposit(winner.id, 50_000)
    const lot = await createLot(auctioneer.id, { title: "Black Lotus" })
    await bid(lot.id, winner.id, 12_000)
    await settleLot(lot.id, AFTER_END)
    return { auctioneer, winner, lot }
  }

  it("o vencedor vê o débito e o leiloeiro vê o crédito, com o nome do lote", async () => {
    const { auctioneer, winner } = await soldLot()

    const bidderView = (await entries(winner.cookies)).json()
    expect(bidderView.items[0]).toMatchObject({
      kind: "lot_debit",
      amountCents: -12_000,
      balanceAfterCents: 38_000,
      lotTitle: "Black Lotus",
    })

    const auctioneerView = (await entries(auctioneer.cookies)).json()
    expect(auctioneerView.items).toHaveLength(1)
    expect(auctioneerView.items[0]).toMatchObject({
      kind: "lot_credit",
      amountCents: 12_000,
      balanceAfterCents: 12_000,
      lotTitle: "Black Lotus",
    })
  })

  it("lote sem lances ou cancelado não mexe no extrato", async () => {
    const auctioneer = await signUp(app, "auctioneer")
    const lot = await createLot(auctioneer.id)
    await settleLot(lot.id, AFTER_END)
    expect((await entries(auctioneer.cookies)).json().total).toBe(0)
  })

  it("cada usuário só vê o próprio extrato", async () => {
    const { winner } = await soldLot()
    const other = await signUp(app, "bidder", "outro@teste.com")
    expect((await entries(other.cookies)).json().total).toBe(0)
    expect((await entries(winner.cookies)).json().total).toBeGreaterThan(0)
  })
})

describe("GET /api/wallet/entries", () => {
  it("exige login", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/wallet/entries",
    })
    expect(response.statusCode).toBe(401)
  })

  it("pagina do mais recente para o mais antigo", async () => {
    const { id, cookies } = await signUp(app, "bidder")
    for (let n = 1; n <= 5; n++) await deposit(id, n * 100)

    const first = (await entries(cookies, "?limit=2&offset=0")).json()
    const last = (await entries(cookies, "?limit=2&offset=4")).json()
    expect(
      first.items.map((i: { amountCents: number }) => i.amountCents),
    ).toEqual([500, 400])
    expect(
      last.items.map((i: { amountCents: number }) => i.amountCents),
    ).toEqual([100])
    expect(first.total).toBe(5)
  })

  it("recusa limite fora da faixa", async () => {
    const { cookies } = await signUp(app, "bidder")
    for (const query of ["?limit=0", "?limit=101", "?offset=-1"]) {
      expect((await entries(cookies, query)).statusCode).toBe(400)
    }
  })
})

describe("o extrato só aceita inserção", () => {
  async function oneEntry() {
    const user = await createUser()
    await deposit(user.id, 1_000)
    const [entry] = await db.select().from(walletEntries)
    return entry
  }

  it("recusa UPDATE e DELETE", async () => {
    const entry = await oneEntry()
    await expect(
      db
        .update(walletEntries)
        .set({ amountCents: 1 })
        .where(eq(walletEntries.id, entry.id)),
    ).rejects.toThrow()
    await expect(
      db.delete(walletEntries).where(eq(walletEntries.id, entry.id)),
    ).rejects.toThrow()
    expect(await db.select().from(walletEntries)).toHaveLength(1)
  })

  it("recusa débito com valor positivo e valor zero", async () => {
    const user = await createUser()
    const insert = (kind: "lot_debit" | "deposit", amountCents: number) =>
      db.insert(walletEntries).values({
        userId: user.id,
        kind,
        amountCents,
        balanceAfterCents: 0,
      })
    await expect(insert("lot_debit", 100)).rejects.toThrow()
    await expect(insert("deposit", 0)).rejects.toThrow()
    await expect(insert("deposit", -100)).rejects.toThrow()
  })
})

describe("invariante: soma do extrato = saldo", () => {
  it("vale depois de depósitos e liquidações simultâneos", async () => {
    const auctioneer = await createUser({ role: "auctioneer" })
    const people = await Promise.all(
      [1, 2, 3].map(() => createUser({ role: "bidder" })),
    )
    for (const person of people) await deposit(person.id, 100_000)

    // três lotes, cada um com um líder diferente
    const lots = await Promise.all(people.map(() => createLot(auctioneer.id)))
    await Promise.all(
      people.map((person, i) => bid(lots[i].id, person.id, 10_000 + i * 500)),
    )

    // depósitos e liquidações ao mesmo tempo, sobre os mesmos usuários
    await Promise.all([
      ...people.flatMap((person) =>
        [1, 2, 3, 4, 5].map((n) => deposit(person.id, n * 100)),
      ),
      ...lots.map((lot) => settleLot(lot.id, AFTER_END)),
    ])

    expect(await verifyLedger()).toEqual([])

    const [{ total }] = await db
      .select({ total: sql<string>`sum(${users.balanceCents})` })
      .from(users)
    const [{ sum }] = await db
      .select({ sum: sql<string>`sum(${walletEntries.amountCents})` })
      .from(walletEntries)
    expect(sum).toBe(total)
  })

  it("a última linha de cada usuário tem o saldo atual", async () => {
    const user = await createUser()
    await Promise.all([1, 2, 3, 4].map((n) => deposit(user.id, n * 1_000)))
    const [last] = await db
      .select()
      .from(walletEntries)
      .orderBy(sql`${walletEntries.id} desc`)
      .limit(1)
    const [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(last.balanceAfterCents).toBe(row.balanceCents)
    expect(row.balanceCents).toBe(10_000)
  })

  it("detecta um saldo mexido direto no banco", async () => {
    const user = await createUser()
    await deposit(user.id, 5_000)
    expect(await verifyLedger()).toEqual([])

    await db
      .update(users)
      .set({ balanceCents: 9_999 })
      .where(eq(users.id, user.id))
    const mismatches = await verifyLedger()
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]).toMatchObject({
      userId: user.id,
      balanceCents: 9_999,
      entriesSumCents: 5_000,
    })
  })

  it("usuário sem movimento e sem saldo está em ordem", async () => {
    await createUser()
    expect(await verifyLedger()).toEqual([])
  })
})
