import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

export const userRole = pgEnum("user_role", ["auctioneer", "bidder"])

const cents = (name: string) => bigint(name, { mode: "number" })
const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export type LotAttributes = {
  set?: string
  rarity?: string
  artist?: string
  typeLine?: string
  releasedAt?: string
  refPriceUsd?: string | null
  refPriceEur?: string | null
}

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    balanceCents: cents("balance_cents").notNull().default(0),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [check("users_balance_non_negative", sql`${t.balanceCents} >= 0`)],
)

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctioneerId: uuid("auctioneer_id")
      .notNull()
      .references(() => users.id),
    scryfallId: text("scryfall_id").notNull(),
    title: text("title").notNull(),
    imageUrl: text("image_url").notNull(),
    attributes: jsonb("attributes").$type<LotAttributes>().notNull(),
    startingBidCents: cents("starting_bid_cents").notNull(),
    minIncrementCents: cents("min_increment_cents").notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    originalEndsAt: timestamptz("original_ends_at").notNull(),
    currentBidCents: cents("current_bid_cents"),
    leaderId: uuid("leader_id").references(() => users.id),
    bidCount: integer("bid_count").notNull().default(0),
    headMac: text("head_mac").notNull(),
    cancelledAt: timestamptz("cancelled_at"),
    settledAt: timestamptz("settled_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("lots_starting_bid_positive", sql`${t.startingBidCents} > 0`),
    check("lots_min_increment_positive", sql`${t.minIncrementCents} > 0`),
    check("lots_schedule_valid", sql`${t.endsAt} > ${t.startsAt}`),
    index("lots_schedule_idx").on(t.startsAt, t.endsAt),
    index("lots_leader_idx").on(t.leaderId),
    index("lots_pending_settlement_idx")
      .on(t.endsAt)
      .where(sql`${t.settledAt} is null and ${t.cancelledAt} is null`),
  ],
)

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => users.id),
    seq: integer("seq").notNull(),
    amountCents: cents("amount_cents").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    mac: text("mac").notNull(),
  },
  (t) => [unique("bids_lot_seq_unique").on(t.lotId, t.seq)],
)

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id")
    .notNull()
    .unique()
    .references(() => lots.id),
  winnerId: uuid("winner_id")
    .notNull()
    .references(() => users.id),
  amountCents: cents("amount_cents").notNull(),
  chainMac: text("chain_mac").notNull(),
  issuedAt: timestamptz("issued_at").notNull().defaultNow(),
})
