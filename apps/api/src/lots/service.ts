import { randomUUID } from "node:crypto"
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import { chain } from "../audit/index.js"
import { minimumBidCents } from "../bids/rules.js"
import { scryfall } from "../cards/scryfall.js"
import { db } from "../db/client.js"
import { bids, lots, receipts } from "../db/schema.js"
import { AppError } from "../errors.js"
import { lotEvents } from "../events/bus.js"
import type { LotSummary } from "./schemas.js"
import { type LotStatus, lotStatus } from "./status.js"

type Lot = typeof lots.$inferSelect

// Deixa o leiloeiro escolher "começar agora" sem esbarrar no relógio
const START_TOLERANCE_MS = 60_000

export function toSummary(lot: Lot, now: Date): LotSummary {
  return {
    id: lot.id,
    title: lot.title,
    imageUrl: lot.imageUrl,
    attributes: lot.attributes,
    status: lotStatus(lot, now),
    startingBidCents: lot.startingBidCents,
    minIncrementCents: lot.minIncrementCents,
    currentBidCents: lot.currentBidCents,
    minNextBidCents: minimumBidCents(lot),
    bidCount: lot.bidCount,
    startsAt: lot.startsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    originalEndsAt: lot.originalEndsAt.toISOString(),
  }
}

type CreateLotInput = {
  auctioneerId: string
  scryfallId: string
  startingBidCents: number
  minIncrementCents: number
  startsAt: Date
  endsAt: Date
}

export async function createLot(input: CreateLotInput, now = new Date()) {
  const { startsAt, endsAt } = input
  if (endsAt <= startsAt) {
    throw new AppError(
      422,
      "INVALID_SCHEDULE",
      "O fim do leilão deve ser depois do início.",
    )
  }
  if (startsAt.getTime() < now.getTime() - START_TOLERANCE_MS) {
    throw new AppError(
      422,
      "INVALID_SCHEDULE",
      "O início do leilão não pode estar no passado.",
    )
  }

  // A carta é copiada para o banco, então o lote não depende mais do Scryfall
  const card = await scryfall.getCard(input.scryfallId)

  const id = randomUUID()
  const [lot] = await db
    .insert(lots)
    .values({
      id,
      auctioneerId: input.auctioneerId,
      scryfallId: card.scryfallId,
      title: card.name,
      imageUrl: card.imageUrl,
      attributes: {
        set: card.set,
        rarity: card.rarity,
        artist: card.artist ?? undefined,
        typeLine: card.typeLine,
        releasedAt: card.releasedAt,
        refPriceUsd: card.refPriceUsd,
        refPriceEur: card.refPriceEur,
      },
      startingBidCents: input.startingBidCents,
      minIncrementCents: input.minIncrementCents,
      startsAt,
      endsAt,
      originalEndsAt: endsAt,
      headMac: chain.initialHeadMac({
        id,
        startingBidCents: input.startingBidCents,
        minIncrementCents: input.minIncrementCents,
        startsAt,
      }),
    })
    .returning()
  return toSummary(lot, now)
}

type ListFilter = {
  status?: Exclude<LotStatus, "cancelled">
  q?: string
  limit: number
  offset: number
}

function statusCondition(status: ListFilter["status"], now: Date) {
  if (status === "live")
    return and(lte(lots.startsAt, now), gt(lots.endsAt, now))
  if (status === "scheduled") return gt(lots.startsAt, now)
  if (status === "ended") return lte(lots.endsAt, now)
  return undefined
}

function searchCondition(q: string | undefined) {
  if (!q) return undefined
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  return or(
    ilike(lots.title, pattern),
    sql`${lots.attributes}->>'set' ilike ${pattern}`,
  )
}

// A vitrine nunca mostra lotes cancelados
export async function listLots(filter: ListFilter, now = new Date()) {
  const where = and(
    isNull(lots.cancelledAt),
    statusCondition(filter.status, now),
    searchCondition(filter.q),
  )
  const order =
    filter.status === "ended"
      ? desc(lots.endsAt)
      : filter.status
        ? asc(filter.status === "live" ? lots.endsAt : lots.startsAt)
        : desc(lots.createdAt)

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(lots)
      .where(where)
      .orderBy(order, asc(lots.id))
      .limit(filter.limit)
      .offset(filter.offset),
    db.$count(lots, where),
  ])
  return { items: rows.map((lot) => toSummary(lot, now)), total }
}

export async function getLotDetail(
  lotId: string,
  viewerId: string | null,
  now = new Date(),
) {
  const [lot] = await db.select().from(lots).where(eq(lots.id, lotId))
  if (!lot) throw new AppError(404, "NOT_FOUND", "Lote não encontrado.")

  const rows = await db
    .select()
    .from(bids)
    .where(eq(bids.lotId, lotId))
    .orderBy(asc(bids.seq))
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.lotId, lotId))

  const summary = toSummary(lot, now)
  const outcome =
    summary.status !== "ended"
      ? null
      : receipt
        ? "sold"
        : lot.bidCount === 0
          ? "unsold"
          : "settling"

  return {
    ...summary,
    bids: rows.map((bid) => ({
      seq: bid.seq,
      pseudonym: chain.pseudonym(lotId, bid.bidderId),
      amountCents: bid.amountCents,
      createdAt: bid.createdAt.toISOString(),
    })),
    serverNow: now.toISOString(),
    myPseudonym: viewerId ? chain.pseudonym(lotId, viewerId) : null,
    result: {
      outcome,
      finalAmountCents: receipt?.amountCents ?? null,
      receiptId: receipt?.id ?? null,
      winnerPseudonym: receipt
        ? chain.pseudonym(lotId, receipt.winnerId)
        : null,
    },
  } as const
}

// Com lances, só cancela se o leiloeiro confirmar.
// O estorno é automático. O saldo só é debitado na liquidação, então o valor comprometido some junto.
export async function cancelLot(
  lotId: string,
  auctioneerId: string,
  { confirmBids = false }: { confirmBids?: boolean } = {},
  now = new Date(),
) {
  let cancelledNow = false
  const summary = await db.transaction(async (tx) => {
    // Mesmo lock do lance: cancelamento e lance nunca se cruzam
    const [lot] = await tx
      .select()
      .from(lots)
      .where(eq(lots.id, lotId))
      .for("update")
    if (!lot) throw new AppError(404, "NOT_FOUND", "Lote não encontrado.")
    if (lot.auctioneerId !== auctioneerId) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Este lote pertence a outro leiloeiro.",
      )
    }
    if (lot.cancelledAt) return toSummary(lot, now)
    if (lot.settledAt) {
      throw new AppError(
        409,
        "LOT_ALREADY_SETTLED",
        "Este lote já foi liquidado.",
      )
    }
    if (lot.bidCount > 0 && !confirmBids) {
      throw new AppError(
        409,
        "LOT_HAS_BIDS",
        `Este lote já recebeu ${lot.bidCount} ${lot.bidCount === 1 ? "lance" : "lances"}. Confirme o cancelamento para estornar o valor reservado.`,
      )
    }

    const [updated] = await tx
      .update(lots)
      .set({ cancelledAt: now })
      .where(eq(lots.id, lotId))
      .returning()
    cancelledNow = true
    return toSummary(updated, now)
  })

  if (cancelledNow) lotEvents.publish(lotId, { type: "cancelled", data: {} })
  return summary
}

export async function listAuctioneerLots(
  auctioneerId: string,
  now = new Date(),
) {
  const rows = await db
    .select({ lot: lots, receipt: receipts })
    .from(lots)
    .leftJoin(receipts, eq(receipts.lotId, lots.id))
    .where(eq(lots.auctioneerId, auctioneerId))
    .orderBy(desc(lots.createdAt), asc(lots.id))

  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${receipts.amountCents}), 0)` })
    .from(receipts)
    .innerJoin(lots, eq(lots.id, receipts.lotId))
    .where(eq(lots.auctioneerId, auctioneerId))

  return {
    lots: rows.map(({ lot, receipt }) => {
      const summary = toSummary(lot, now)
      const ended = summary.status === "ended"
      const outcome = !ended
        ? null
        : receipt
          ? "sold"
          : lot.bidCount === 0
            ? "unsold"
            : "settling"
      return {
        ...summary,
        result: {
          outcome,
          finalAmountCents: receipt?.amountCents ?? null,
          receiptId: receipt?.id ?? null,
        } as const,
      }
    }),
    totalReceivedCents: Number(total),
  }
}
