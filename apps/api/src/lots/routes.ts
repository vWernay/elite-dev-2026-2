import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { optionalUser, requireRole } from "../auth/guards.js"
import {
  auctioneerLotSchema,
  lotDetailSchema,
  lotSummarySchema,
} from "./schemas.js"
import {
  cancelLot,
  createLot,
  getLotDetail,
  listAuctioneerLots,
  listLots,
} from "./service.js"

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s))
const idParams = z.object({ id: z.uuid() })

export const lotRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: {
        querystring: z.object({
          status: z.enum(["live", "scheduled", "ended"]).optional(),
          q: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(lotSummarySchema),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => listLots(request.query),
  )

  app.get(
    "/:id",
    { schema: { params: idParams, response: { 200: lotDetailSchema } } },
    async (request) => {
      const user = await optionalUser(request)
      return getLotDetail(request.params.id, user?.sub ?? null)
    },
  )

  app.post(
    "/",
    {
      preHandler: requireRole("auctioneer"),
      schema: {
        body: z.object({
          scryfallId: z.string().min(1).max(100),
          startingBidCents: z.number().int().positive(),
          minIncrementCents: z.number().int().positive(),
          startsAt: isoDate,
          endsAt: isoDate,
        }),
        response: { 201: lotSummarySchema },
      },
    },
    async (request, reply) => {
      const lot = await createLot({
        auctioneerId: request.user.sub,
        ...request.body,
      })
      return reply.code(201).send(lot)
    },
  )

  app.post(
    "/:id/cancel",
    {
      preHandler: requireRole("auctioneer"),
      schema: {
        params: idParams,
        body: z.object({ confirmBids: z.boolean().optional() }).nullish(),
        response: { 200: lotSummarySchema },
      },
    },
    async (request) =>
      cancelLot(request.params.id, request.user.sub, {
        confirmBids: request.body?.confirmBids,
      }),
  )
}

export const auctioneerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/lots",
    {
      preHandler: requireRole("auctioneer"),
      schema: {
        response: {
          200: z.object({
            lots: z.array(auctioneerLotSchema),
            totalReceivedCents: z.number(),
          }),
        },
      },
    },
    async (request) => listAuctioneerLots(request.user.sub),
  )
}
