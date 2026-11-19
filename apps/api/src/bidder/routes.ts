import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { requireRole } from "../auth/guards.js"
import { lotSummarySchema } from "../lots/schemas.js"
import { listBidderLots } from "./service.js"

const stateSchema = z.enum(["leading", "outbid", "won", "lost", "cancelled"])

const bidderLotSchema = lotSummarySchema.extend({
  state: stateSchema,
  myHighestBidCents: z.number(),
  receiptId: z.uuid().nullable(),
})

export const bidderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/lots",
    {
      preHandler: requireRole("bidder"),
      schema: {
        querystring: z.object({
          filter: z.enum(["all", "ongoing", "won", "lost"]).default("all"),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            lots: z.array(bidderLotSchema),
            // total do filtro escolhido; counts vale para todos os lotes do usuário
            total: z.number(),
            counts: z.object({
              all: z.number(),
              ongoing: z.number(),
              won: z.number(),
              lost: z.number(),
            }),
          }),
        },
      },
    },
    async (request) => listBidderLots(request.user.sub, request.query),
  )
}
