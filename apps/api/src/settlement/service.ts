import { and, asc, eq, isNull, lte, sql } from "drizzle-orm"
import { chain } from "../audit/index.js"
import { db } from "../db/client.js"
import { bids, lots, receipts, users } from "../db/schema.js"
import { lotEvents } from "../events/bus.js"

export type SettleResult =
  | {
      outcome: "sold"
      lotId: string
      receiptId: string
      winnerId: string
      amountCents: number
    }
  | { outcome: "unsold"; lotId: string }
  | { outcome: "tampered"; lotId: string }
  | { outcome: "skipped"; lotId: string }
  | { outcome: "failed"; lotId: string; error: unknown }

type Clock = () => Date

export async function settleLot(
  lotId: string,
  clock: Clock = () => new Date(),
): Promise<SettleResult> {
  const result = await db.transaction(async (tx): Promise<SettleResult> => {
    // SKIP LOCKED: se um lance ou outro worker está com o lote, tenta na próxima
    const [lot] = await tx
      .select()
      .from(lots)
      .where(eq(lots.id, lotId))
      .for("update", { skipLocked: true })
    if (!lot) return { outcome: "skipped", lotId }

    // Conferindo de novo, um lance de última hora pode ter prorrogado o lote
    const now = clock()
    if (lot.settledAt || lot.cancelledAt || now < lot.endsAt) {
      return { outcome: "skipped", lotId }
    }

    if (lot.bidCount === 0) {
      await tx.update(lots).set({ settledAt: now }).where(eq(lots.id, lotId))
      return { outcome: "unsold", lotId }
    }

    const rows = await tx
      .select()
      .from(bids)
      .where(eq(bids.lotId, lotId))
      .orderBy(asc(bids.seq))
    const audit = chain.verify(lot, rows)
    if (audit.verdict !== "intact" || !lot.leaderId || !lot.currentBidCents) {
      return { outcome: "tampered", lotId }
    }
    const winnerId = lot.leaderId
    const amountCents = lot.currentBidCents

    // Ordem de locks: lote, depois os usuários por id
    for (const userId of [winnerId, lot.auctioneerId].sort()) {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
    }
    await tx
      .update(users)
      .set({ balanceCents: sql`${users.balanceCents} - ${amountCents}` })
      .where(eq(users.id, winnerId))
    await tx
      .update(users)
      .set({ balanceCents: sql`${users.balanceCents} + ${amountCents}` })
      .where(eq(users.id, lot.auctioneerId))

    // UNIQUE (lot_id) em receipts impede liquidar o mesmo lote duas vezes
    const [receipt] = await tx
      .insert(receipts)
      .values({
        lotId,
        winnerId,
        amountCents,
        chainMac: lot.headMac,
        issuedAt: now,
      })
      .returning({ id: receipts.id })
    await tx.update(lots).set({ settledAt: now }).where(eq(lots.id, lotId))

    return {
      outcome: "sold",
      lotId,
      receiptId: receipt.id,
      winnerId,
      amountCents,
    }
  })

  // Só depois do commit; lote adulterado ou pulado não gera evento
  if (result.outcome === "sold") {
    lotEvents.publish(lotId, {
      type: "settled",
      data: {
        receiptId: result.receiptId,
        winnerPseudonym: chain.pseudonym(lotId, result.winnerId),
      },
    })
  } else if (result.outcome === "unsold") {
    lotEvents.publish(lotId, {
      type: "settled",
      data: { receiptId: null, winnerPseudonym: null },
    })
  }
  return result
}

// Um lote com problema não trava os outros
export async function settleDueLots(clock: Clock = () => new Date()) {
  const due = await db
    .select({ id: lots.id })
    .from(lots)
    .where(
      and(
        lte(lots.endsAt, clock()),
        isNull(lots.settledAt),
        isNull(lots.cancelledAt),
      ),
    )
    .orderBy(asc(lots.endsAt))

  const results: SettleResult[] = []
  for (const { id } of due) {
    try {
      results.push(await settleLot(id, clock))
    } catch (error) {
      results.push({ outcome: "failed", lotId: id, error })
    }
  }
  return results
}
