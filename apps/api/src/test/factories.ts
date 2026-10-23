import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { chain } from "../audit/index.js"
import { db } from "../db/client.js"
import { lots, users } from "../db/schema.js"

export const T0 = new Date("2026-10-23T12:00:00.000Z")
export const minutes = (n: number) => n * 60_000
export const addMs = (base: Date, ms: number) => new Date(base.getTime() + ms)

export async function resetDb() {
  await db.execute(
    sql`truncate table receipts, bids, lots, users restart identity cascade`,
  )
}

export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const id = randomUUID()
  const [user] = await db
    .insert(users)
    .values({
      id,
      name: "Teste",
      email: `${id}@teste.com`,
      passwordHash: "x",
      role: "bidder",
      ...overrides,
    })
    .returning()
  return user
}

// Lote ao vivo entre T0 e T0 + 1h, com head_mac inicial correto.
export async function createLot(
  auctioneerId: string,
  overrides: Partial<typeof lots.$inferInsert> = {},
) {
  const id = randomUUID()
  const startsAt = overrides.startsAt ?? T0
  const endsAt = overrides.endsAt ?? addMs(startsAt, minutes(60))
  const startingBidCents = overrides.startingBidCents ?? 10_000
  const minIncrementCents = overrides.minIncrementCents ?? 500

  const [lot] = await db
    .insert(lots)
    .values({
      id,
      auctioneerId,
      scryfallId: "teste",
      title: "Carta de teste",
      imageUrl: "https://exemplo.com/carta.png",
      attributes: {},
      startingBidCents,
      minIncrementCents,
      startsAt,
      endsAt,
      originalEndsAt: endsAt,
      headMac: chain.initialHeadMac({
        id,
        startingBidCents,
        minIncrementCents,
        startsAt,
      }),
      ...overrides,
    })
    .returning()
  return lot
}
