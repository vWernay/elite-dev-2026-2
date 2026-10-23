import { and, eq, isNull, sql } from "drizzle-orm"
import type { DbOrTx } from "../db/client.js"
import { lots } from "../db/schema.js"

// Soma dos lances que o usuário está liderando e ainda não foram liquidados.
export async function committedCents(executor: DbOrTx, userId: string) {
  const [row] = await executor
    .select({ total: sql<string>`coalesce(sum(${lots.currentBidCents}), 0)` })
    .from(lots)
    .where(
      and(
        eq(lots.leaderId, userId),
        isNull(lots.settledAt),
        isNull(lots.cancelledAt),
      ),
    )
  return Number(row.total)
}
