import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { requireRole } from "../auth/guards.js"
import { placeBid } from "./service.js"

const placedBidSchema = z.object({
  bid: z.object({
    seq: z.number(),
    pseudonym: z.string(),
    amountCents: z.number(),
    createdAt: z.string(),
  }),
  lot: z.object({
    currentBidCents: z.number(),
    bidCount: z.number(),
    minNextBidCents: z.number(),
    endsAt: z.string(),
    extended: z.boolean(),
  }),
})

export const bidRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/:id/bids",
    {
      preHandler: requireRole("bidder"),
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ amountCents: z.number().int().positive() }),
        response: { 201: placedBidSchema },
      },
    },
    async (request, reply) => {
      const { bid, lot } = await placeBid({
        lotId: request.params.id,
        bidderId: request.user.sub,
        amountCents: request.body.amountCents,
      })
      return reply.code(201).send({
        bid: { ...bid, createdAt: bid.createdAt.toISOString() },
        lot: { ...lot, endsAt: lot.endsAt.toISOString() },
      })
    },
  )
}
