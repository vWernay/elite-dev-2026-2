import { desc, eq } from "drizzle-orm"
import type { DbOrTx } from "../db/client.js"
import { bids } from "../db/schema.js"
import { chain } from "./index.js"

// MAC do último lance do lote, ou o elo inicial quando ainda não há lances
export async function lastMac(
  executor: DbOrTx,
  lot: Parameters<typeof chain.genesis>[0] & { id: string },
) {
  const [last] = await executor
    .select({ mac: bids.mac })
    .from(bids)
    .where(eq(bids.lotId, lot.id))
    .orderBy(desc(bids.seq))
    .limit(1)
  return last?.mac ?? chain.genesis(lot)
}
