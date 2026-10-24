import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { requireRole } from "../auth/guards.js"
import { scryfall } from "./scryfall.js"

const cardSchema = z.object({
  scryfallId: z.string(),
  name: z.string(),
  imageUrl: z.string(),
  set: z.string(),
  rarity: z.string(),
  artist: z.string().nullable(),
  typeLine: z.string(),
  releasedAt: z.string(),
  refPriceUsd: z.string().nullable(),
  refPriceEur: z.string().nullable(),
})

export const cardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/search",
    {
      preHandler: requireRole("auctioneer"),
      schema: {
        querystring: z.object({
          q: z.string().trim().min(2).max(100),
          page: z.coerce.number().int().min(1).max(50).default(1),
        }),
        response: {
          200: z.object({
            cards: z.array(cardSchema),
            hasMore: z.boolean(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) =>
      scryfall.searchCards(request.query.q, request.query.page),
  )
}
