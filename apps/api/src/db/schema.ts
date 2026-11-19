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

export const sessions = pgTable(
  "sessions",
  {
    // hash SHA-256 do token que vai no cookie
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
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
    // Versão da fórmula da cadeia. 1 = lotes anteriores à v2 (padrão do banco);
    // a aplicação grava 2 nos lotes novos
    chainVersion: integer("chain_version").notNull().default(1),
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
    // painel do leiloeiro: lotes dele, do mais novo para o mais antigo.
    // "desc" puro (nulls first) para casar com o ORDER BY da consulta
    index("lots_auctioneer_created_idx").on(
      t.auctioneerId,
      sql`${t.createdAt} desc`,
      t.id,
    ),
    // vitrine: ordenação sem filtro e por fim (ao vivo e encerrados); nunca lista cancelados
    index("lots_showcase_created_idx")
      .on(sql`${t.createdAt} desc`, t.id)
      .where(sql`${t.cancelledAt} is null`),
    index("lots_showcase_ends_idx")
      .on(t.endsAt, t.id)
      .where(sql`${t.cancelledAt} is null`),
    // busca da vitrine (ILIKE '%texto%'), com pg_trgm
    index("lots_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("lots_set_trgm_idx").using(
      "gin",
      sql`(${t.attributes}->>'set') gin_trgm_ops`,
    ),
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
    // fim do lote depois deste lance (cadeia v2); nulo nos lotes v1
    endsAtAfter: timestamptz("ends_at_after"),
    mac: text("mac").notNull(),
  },
  (t) => [
    unique("bids_lot_seq_unique").on(t.lotId, t.seq),
    // "Meus arremates": lotes em que o usuário deu lance
    index("bids_bidder_lot_idx").on(t.bidderId, t.lotId),
  ],
)

export const receipts = pgTable(
  "receipts",
  {
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
  },
  (t) => [index("receipts_winner_idx").on(t.winnerId)],
)
