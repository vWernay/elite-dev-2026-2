import { asc, eq } from "drizzle-orm"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { chain } from "../audit/index.js"
import { db } from "../db/client.js"
import { bids, lots, receipts } from "../db/schema.js"
import { AppError } from "../errors.js"
import { attributesSchema } from "../lots/schemas.js"

const receiptSchema = z.object({
  id: z.uuid(),
  lot: z.object({
    id: z.uuid(),
    title: z.string(),
    imageUrl: z.string(),
    attributes: attributesSchema,
  }),
  winnerPseudonym: z.string(),
  amountCents: z.number(),
  issuedAt: z.string(),
  fingerprint: z.string(),
  chainValid: z.boolean(),
})

// Público: identifica o vencedor só pelo pseudônimo daquele lote
export const receiptRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: receiptSchema },
      },
    },
    async (request) => {
      const [row] = await db
        .select({ receipt: receipts, lot: lots })
        .from(receipts)
        .innerJoin(lots, eq(lots.id, receipts.lotId))
        .where(eq(receipts.id, request.params.id))
      if (!row)
        throw new AppError(404, "NOT_FOUND", "Comprovante não encontrado.")
      const { receipt, lot } = row

      const rows = await db
        .select()
        .from(bids)
        .where(eq(bids.lotId, lot.id))
        .orderBy(asc(bids.seq))

      return {
        id: receipt.id,
        lot: {
          id: lot.id,
          title: lot.title,
          imageUrl: lot.imageUrl,
          attributes: lot.attributes,
        },
        winnerPseudonym: chain.pseudonym(lot.id, receipt.winnerId),
        amountCents: receipt.amountCents,
        issuedAt: receipt.issuedAt.toISOString(),
        fingerprint: chain.fingerprint(receipt.chainMac),
        chainValid: chain.verifyReceipt(lot, rows, receipt),
      }
    },
  )
}
