import type { lots } from "../db/schema.js"

type Lot = typeof lots.$inferSelect

export type LotStatus = "cancelled" | "scheduled" | "live" | "ended"

// O status é sempre calculado pelo horário, nunca gravado
export function lotStatus(
  lot: Pick<Lot, "cancelledAt" | "startsAt" | "endsAt">,
  now: Date,
): LotStatus {
  if (lot.cancelledAt) return "cancelled"
  if (now < lot.startsAt) return "scheduled"
  if (now < lot.endsAt) return "live"
  return "ended"
}
