import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { authenticate, requireRole } from "../auth/guards.js"
import { listEntries } from "./ledger.js"
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

  // Extrato: vale para licitante (depósitos e arremates) e leiloeiro (créditos)
  app.get(
    "/entries",
    {
      preHandler: authenticate,
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.number(),
                kind: z.enum([
                  "opening",
                  "deposit",
                  "lot_debit",
                  "lot_credit",
                  "adjustment",
                ]),
                amountCents: z.number(),
                balanceAfterCents: z.number(),
                lotId: z.uuid().nullable(),
                lotTitle: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => listEntries(request.user.sub, request.query),
  )
}
