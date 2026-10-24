import { desc, eq, inArray, max } from "drizzle-orm"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { requireRole } from "../auth/guards.js"
import { db } from "../db/client.js"
import { bids, lots, receipts } from "../db/schema.js"
import { lotSummarySchema } from "../lots/schemas.js"
import { toSummary } from "../lots/service.js"

const stateSchema = z.enum(["leading", "outbid", "won", "lost"])

const bidderLotSchema = lotSummarySchema.extend({
  state: stateSchema,
  myHighestBidCents: z.number(),
  receiptId: z.uuid().nullable(),
})

export const bidderRoutes: FastifyPluginAsyncZod = async (app) => {
  // Lotes em que o usuário deu lance; o comprovante só existe para quem venceu
  app.get(
    "/lots",
    {
      preHandler: requireRole("bidder"),
      schema: {
        response: { 200: z.object({ lots: z.array(bidderLotSchema) }) },
      },
    },
    async (request) => {
      const userId = request.user.sub
      const mine = await db
        .select({ lotId: bids.lotId, best: max(bids.amountCents) })
        .from(bids)
        .where(eq(bids.bidderId, userId))
        .groupBy(bids.lotId)
      if (mine.length === 0) return { lots: [] }

      const best = new Map(mine.map((row) => [row.lotId, row.best ?? 0]))
      const rows = await db
        .select({ lot: lots, receipt: receipts })
        .from(lots)
        .leftJoin(receipts, eq(receipts.lotId, lots.id))
        .where(inArray(lots.id, [...best.keys()]))
        .orderBy(desc(lots.endsAt))

      const now = new Date()
      return {
        lots: rows.map(({ lot, receipt }) => {
          const leading = lot.leaderId === userId
          const state = receipt
            ? receipt.winnerId === userId
              ? "won"
              : "lost"
            : leading
              ? "leading"
              : "outbid"
          return {
            ...toSummary(lot, now),
            state,
            myHighestBidCents: best.get(lot.id) ?? 0,
            receiptId: state === "won" ? (receipt?.id ?? null) : null,
          } as const
        }),
      }
    },
  )
}
