import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { requireRole } from "../auth/guards.js"
import { deposit, getWallet, MAX_DEPOSIT_CENTS } from "./service.js"

const walletSchema = z.object({
  balanceCents: z.number(),
  committedCents: z.number(),
  availableCents: z.number(),
})

export const walletRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: requireRole("bidder"),
      schema: { response: { 200: walletSchema } },
    },
    async (request) => getWallet(request.user.sub),
  )

  app.post(
    "/deposits",
    {
      preHandler: requireRole("bidder"),
      schema: {
        body: z.object({
          amountCents: z.number().int().positive().max(MAX_DEPOSIT_CENTS),
        }),
        response: { 201: walletSchema },
      },
    },
    async (request, reply) => {
      const wallet = await deposit(request.user.sub, request.body.amountCents)
      return reply.code(201).send(wallet)
    },
  )
}
