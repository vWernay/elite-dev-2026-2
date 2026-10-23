import type { lots } from "../db/schema.js"
import { AppError } from "../errors.js"
import { formatCents } from "../money.js"

type Lot = typeof lots.$inferSelect

export const EXTENSION_MS = 2 * 60 * 1000

export function minimumBidCents(
  lot: Pick<
    Lot,
    "bidCount" | "startingBidCents" | "currentBidCents" | "minIncrementCents"
  >,
) {
  if (lot.bidCount === 0 || lot.currentBidCents === null) {
    return lot.startingBidCents
  }
  return lot.currentBidCents + lot.minIncrementCents
}

export function assertBiddable(lot: Lot, bidderId: string, now: Date) {
  if (lot.cancelledAt) {
    throw new AppError(409, "LOT_CANCELLED", "Este lote foi cancelado.")
  }
  if (now < lot.startsAt) {
    throw new AppError(409, "LOT_NOT_STARTED", "Este lote ainda não começou.", {
      startsAt: lot.startsAt.toISOString(),
    })
  }
  if (now >= lot.endsAt) {
    throw new AppError(409, "LOT_ENDED", "Este lote já foi encerrado.")
  }
  if (lot.leaderId === bidderId) {
    throw new AppError(
      409,
      "ALREADY_WINNING",
      "Você já está ganhando este lote.",
    )
  }
}

export function assertAboveMinimum(lot: Lot, amountCents: number) {
  const minimumCents = minimumBidCents(lot)
  if (amountCents < minimumCents) {
    throw new AppError(
      422,
      "BID_BELOW_MINIMUM",
      `O lance mínimo agora é ${formatCents(minimumCents)}.`,
      { minimumCents },
    )
  }
}

export function assertFunds(
  amountCents: number,
  balanceCents: number,
  committed: number,
) {
  const availableCents = balanceCents - committed
  if (amountCents > availableCents) {
    throw new AppError(
      422,
      "INSUFFICIENT_FUNDS",
      `Saldo insuficiente. Disponível: ${formatCents(availableCents)}.`,
      { availableCents },
    )
  }
}

// Um lance nos últimos 2 minutos deixa sempre 2 minutos restantes.
export function extendedEndsAt(endsAt: Date, now: Date) {
  const target = new Date(now.getTime() + EXTENSION_MS)
  return target > endsAt ? target : endsAt
}
