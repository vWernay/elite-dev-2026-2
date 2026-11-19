import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  sql,
} from "drizzle-orm"
import { db } from "../db/client.js"
import { bids, lots, receipts } from "../db/schema.js"
import { toSummary } from "../lots/service.js"

export type BidderFilter = "all" | "ongoing" | "won" | "lost"

function filterCondition(filter: BidderFilter, userId: string) {
  if (filter === "ongoing") {
    return and(isNull(lots.cancelledAt), isNull(receipts.id))
  }
  if (filter === "won") return eq(receipts.winnerId, userId)
  if (filter === "lost") {
    return and(isNotNull(receipts.id), ne(receipts.winnerId, userId))
  }
  return undefined
}

// Lotes em que o usuário deu lance; o comprovante só existe para quem venceu.
// A página e o filtro são do banco, e as contagens valem para todos os lotes do usuário.
export async function listBidderLots(
  userId: string,
  {
    filter,
    limit,
    offset,
  }: { filter: BidderFilter; limit: number; offset: number },
  now = new Date(),
) {
  const mine = inArray(
    lots.id,
    db.select({ id: bids.lotId }).from(bids).where(eq(bids.bidderId, userId)),
  )

  const [counts] = await db
    .select({
      all: sql<string>`count(*)`,
      ongoing: sql<string>`count(*) filter (where ${lots.cancelledAt} is null and ${receipts.id} is null)`,
      won: sql<string>`count(*) filter (where ${receipts.winnerId} = ${userId})`,
      lost: sql<string>`count(*) filter (where ${receipts.id} is not null and ${receipts.winnerId} <> ${userId})`,
    })
    .from(lots)
    .leftJoin(receipts, eq(receipts.lotId, lots.id))
    .where(mine)

  const rows = await db
    .select({ lot: lots, receipt: receipts })
    .from(lots)
    .leftJoin(receipts, eq(receipts.lotId, lots.id))
    .where(and(mine, filterCondition(filter, userId)))
    .orderBy(desc(lots.endsAt), asc(lots.id))
    .limit(limit)
    .offset(offset)

  const best = new Map<string, number>()
  if (rows.length > 0) {
    const bestRows = await db
      .select({ lotId: bids.lotId, best: max(bids.amountCents) })
      .from(bids)
      .where(
        and(
          eq(bids.bidderId, userId),
          inArray(
            bids.lotId,
            rows.map((row) => row.lot.id),
          ),
        ),
      )
      .groupBy(bids.lotId)
    for (const row of bestRows) best.set(row.lotId, row.best ?? 0)
  }

  return {
    lots: rows.map(({ lot, receipt }) => {
      const state = lot.cancelledAt
        ? "cancelled"
        : receipt
          ? receipt.winnerId === userId
            ? "won"
            : "lost"
          : lot.leaderId === userId
            ? "leading"
            : "outbid"
      return {
        ...toSummary(lot, now),
        state,
        myHighestBidCents: best.get(lot.id) ?? 0,
        receiptId: state === "won" ? (receipt?.id ?? null) : null,
      } as const
    }),
    total: Number(counts[filter]),
    counts: {
      all: Number(counts.all),
      ongoing: Number(counts.ongoing),
      won: Number(counts.won),
      lost: Number(counts.lost),
    },
  }
}
