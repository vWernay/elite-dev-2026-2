import { asc, eq } from "drizzle-orm"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { db } from "../db/client.js"
import { bids, lots } from "../db/schema.js"
import { AppError } from "../errors.js"
import { statusSchema } from "../lots/schemas.js"
import { lotStatus } from "../lots/status.js"
import { chain } from "./index.js"

const auditSchema = z.object({
  lotId: z.uuid(),
  title: z.string(),
  status: statusSchema,
  verdict: z.enum(["intact", "tampered", "truncated"]),
  firstInvalidSeq: z.number().nullable(),
  fingerprint: z.string(),
  issues: z.array(
    z.enum(["COUNT_MISMATCH", "HEAD_MISMATCH", "LOT_STATE_MISMATCH"]),
  ),
  bids: z.array(
    z.object({
      seq: z.number(),
      pseudonym: z.string(),
      amountCents: z.number(),
      createdAt: z.string(),
      valid: z.boolean(),
    }),
  ),
})

// Público: mostra o histórico completo e se ele foi adulterado
export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:id/audit",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: auditSchema },
      },
    },
    async (request) => {
      const [lot] = await db
        .select()
        .from(lots)
        .where(eq(lots.id, request.params.id))
      if (!lot) throw new AppError(404, "NOT_FOUND", "Lote não encontrado.")

      const rows = await db
        .select()
        .from(bids)
        .where(eq(bids.lotId, lot.id))
        .orderBy(asc(bids.seq))
      const audit = chain.verify(lot, rows)
      const validBySeq = new Map(audit.bids.map((b) => [b.seq, b.valid]))

      return {
        lotId: lot.id,
        title: lot.title,
        status: lotStatus(lot, new Date()),
        verdict: audit.verdict,
        firstInvalidSeq: audit.firstInvalidSeq,
        fingerprint: chain.fingerprint(lot.headMac),
        issues: audit.issues,
        bids: rows.map((bid) => ({
          seq: bid.seq,
          pseudonym: chain.pseudonym(lot.id, bid.bidderId),
          amountCents: bid.amountCents,
          createdAt: bid.createdAt.toISOString(),
          valid: validBySeq.get(bid.seq) ?? false,
        })),
      }
    },
  )
}
