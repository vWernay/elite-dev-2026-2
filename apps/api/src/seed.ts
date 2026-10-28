import argon2 from "argon2"
import { eq, inArray } from "drizzle-orm"
import { chain } from "./audit/index.js"
import { placeBid } from "./bids/service.js"
import { db, pool } from "./db/client.js"
import { bids, lots, receipts, users } from "./db/schema.js"
import { settleLot } from "./settlement/service.js"

// Dados de demo
const PASSWORD = "senha12345"
const DEPOSIT_CENTS = 1_000_000

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const accounts = [
  { email: "leiloeiro@demo.com", name: "Leiloeiro Demo", role: "auctioneer" },
  { email: "ana@demo.com", name: "Ana Souza", role: "bidder" },
  { email: "bruno@demo.com", name: "Bruno Lima", role: "bidder" },
] as const

type Card = {
  scryfallId: string
  title: string
  imageUrl: string
  set: string
  rarity: string
  artist: string
  typeLine: string
  releasedAt: string
  refPriceUsd: string | null
  refPriceEur: string | null
}

type Seed = {
  id: string
  card: Card
  startingBidCents: number
  minIncrementCents: number
  // Início e fim em relação a agora
  startsIn: number
  endsIn: number
  // Lances: licitante, valor e quanto tempo atrás foram dados
  bids: { by: "ana" | "bruno"; cents: number; ago: number }[]
}

// Cartas fixas no código
const cards: Record<string, Card> = {
  lotus: {
    scryfallId: "bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd",
    title: "Black Lotus",
    imageUrl:
      "https://cards.scryfall.io/normal/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg?1783939332",
    set: "Vintage Masters",
    rarity: "bonus",
    artist: "Chris Rahn",
    typeLine: "Artifact",
    releasedAt: "2014-06-16",
    refPriceUsd: null,
    refPriceEur: null,
  },
  bolt: {
    scryfallId: "7673784e-db4b-43a1-8d55-1bb9fc1e284f",
    title: "Lightning Bolt",
    imageUrl:
      "https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008",
    set: "Marvel Super Heroes Commander",
    rarity: "uncommon",
    artist: "Milivoj Ćeran",
    typeLine: "Instant",
    releasedAt: "2026-06-26",
    refPriceUsd: "0.82",
    refPriceEur: "1.89",
  },
  counterspell: {
    scryfallId: "4f616706-ec97-4923-bb1e-11a69fbaa1f8",
    title: "Counterspell",
    imageUrl:
      "https://cards.scryfall.io/normal/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg?1783909630",
    set: "Duskmourn: House of Horror Commander",
    rarity: "uncommon",
    artist: "Zack Stella",
    typeLine: "Instant",
    releasedAt: "2024-09-27",
    refPriceUsd: "4.39",
    refPriceEur: "3.73",
  },
  birds: {
    scryfallId: "492c2f9a-51e7-4e0f-9899-23bf43ea988b",
    title: "Birds of Paradise",
    imageUrl:
      "https://cards.scryfall.io/normal/front/4/9/492c2f9a-51e7-4e0f-9899-23bf43ea988b.jpg?1783903230",
    set: "Marvel Super Heroes Commander",
    rarity: "rare",
    artist: "Kevin Sidharta",
    typeLine: "Creature — Bird",
    releasedAt: "2026-06-26",
    refPriceUsd: "8.26",
    refPriceEur: "8.24",
  },
  angel: {
    scryfallId: "b8c5e74c-96e7-4a1f-93b7-14d776fe4b2d",
    title: "Serra Angel",
    imageUrl:
      "https://cards.scryfall.io/normal/front/b/8/b8c5e74c-96e7-4a1f-93b7-14d776fe4b2d.jpg?1787563091",
    set: "Foundations",
    rarity: "uncommon",
    artist: "Greg Staples",
    typeLine: "Creature — Angel",
    releasedAt: "2026-04-24",
    refPriceUsd: "0.26",
    refPriceEur: "0.59",
  },
}

// Ids fixos
const lotSeeds: Seed[] = [
  {
    // Ao vivo, com disputa acirrada
    id: "5eed0000-0000-4000-8000-000000000001",
    card: cards.lotus,
    startingBidCents: 50_000,
    minIncrementCents: 5_000,
    startsIn: -2 * day,
    endsIn: 30 * day,
    bids: [
      { by: "ana", cents: 50_000, ago: 30 * hour },
      { by: "bruno", cents: 60_000, ago: 26 * hour },
      { by: "ana", cents: 70_000, ago: 20 * hour },
      { by: "bruno", cents: 85_000, ago: 8 * hour },
      { by: "ana", cents: 100_000, ago: 2 * hour },
    ],
  },
  {
    // Termina em minutos: serve para ver a contagem e o anti-sniping
    id: "5eed0000-0000-4000-8000-000000000002",
    card: cards.bolt,
    startingBidCents: 2_000,
    minIncrementCents: 500,
    startsIn: -1 * day,
    endsIn: 25 * minute,
    bids: [
      { by: "bruno", cents: 2_000, ago: 5 * hour },
      { by: "ana", cents: 2_500, ago: 3 * hour },
      { by: "bruno", cents: 3_500, ago: 40 * minute },
    ],
  },
  {
    // Ao vivo, sem lances ainda
    id: "5eed0000-0000-4000-8000-000000000003",
    card: cards.birds,
    startingBidCents: 3_000,
    minIncrementCents: 500,
    startsIn: -3 * hour,
    endsIn: 30 * day,
    bids: [],
  },
  {
    // Agendado
    id: "5eed0000-0000-4000-8000-000000000004",
    card: cards.counterspell,
    startingBidCents: 1_500,
    minIncrementCents: 250,
    startsIn: 14 * day,
    endsIn: 21 * day,
    bids: [],
  },
  {
    // Encerrado e arrematado, gera o comprovante
    id: "5eed0000-0000-4000-8000-000000000005",
    card: cards.angel,
    startingBidCents: 1_000,
    minIncrementCents: 250,
    startsIn: -3 * day,
    endsIn: -1 * day,
    bids: [
      { by: "ana", cents: 1_000, ago: 2 * day + 12 * hour },
      { by: "bruno", cents: 1_500, ago: 2 * day },
      { by: "ana", cents: 2_000, ago: 1 * day + 6 * hour },
    ],
  },
]

async function upsertAccounts() {
  const passwordHash = await argon2.hash(PASSWORD)
  const ids: Record<string, string> = {}
  for (const account of accounts) {
    const values = {
      ...account,
      passwordHash,
      balanceCents: account.role === "bidder" ? DEPOSIT_CENTS : 0,
    }
    const [row] = await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({ target: users.email, set: values })
      .returning({ id: users.id })
    ids[account.email.split("@")[0]] = row.id
  }
  return ids
}

async function removeOldLots() {
  const ids = lotSeeds.map((seed) => seed.id)
  await db.delete(receipts).where(inArray(receipts.lotId, ids))
  await db.delete(bids).where(inArray(bids.lotId, ids))
  await db.delete(lots).where(inArray(lots.id, ids))
}

async function createLot(seed: Seed, auctioneerId: string, now: Date) {
  const startsAt = new Date(now.getTime() + seed.startsIn)
  const endsAt = new Date(now.getTime() + seed.endsIn)
  const { title, ...card } = seed.card
  await db.insert(lots).values({
    id: seed.id,
    auctioneerId,
    scryfallId: card.scryfallId,
    title,
    imageUrl: card.imageUrl,
    attributes: {
      set: card.set,
      rarity: card.rarity,
      artist: card.artist,
      typeLine: card.typeLine,
      releasedAt: card.releasedAt,
      refPriceUsd: card.refPriceUsd,
      refPriceEur: card.refPriceEur,
    },
    startingBidCents: seed.startingBidCents,
    minIncrementCents: seed.minIncrementCents,
    startsAt,
    endsAt,
    originalEndsAt: endsAt,
    headMac: chain.initialHeadMac({
      id: seed.id,
      startingBidCents: seed.startingBidCents,
      minIncrementCents: seed.minIncrementCents,
      startsAt,
    }),
  })
}

try {
  const ids = await upsertAccounts()
  await removeOldLots()

  const now = new Date()
  for (const seed of lotSeeds) {
    await createLot(seed, ids.leiloeiro, now)
    // Os lances passam pelo mesmo serviço da API, com o relógio no passado, logo a cadeia de HMAC e as regras são as de verdade
    for (const bid of seed.bids) {
      await placeBid(
        { lotId: seed.id, bidderId: ids[bid.by], amountCents: bid.cents },
        () => new Date(now.getTime() - bid.ago),
      )
    }
  }

  // O lote encerrado é liquidado na hora
  const settled = await settleLot(lotSeeds[4].id)
  const [check] = await db
    .select({ settledAt: lots.settledAt })
    .from(lots)
    .where(eq(lots.id, lotSeeds[4].id))
  if (settled.outcome !== "sold" || !check.settledAt) {
    throw new Error(`lote encerrado não foi liquidado: ${settled.outcome}`)
  }

  console.log(`seed ok: ${lotSeeds.length} lotes, ${accounts.length} contas`)
  for (const account of accounts) {
    console.log(`  ${account.role.padEnd(10)} ${account.email} / ${PASSWORD}`)
  }
} finally {
  await pool.end()
}
