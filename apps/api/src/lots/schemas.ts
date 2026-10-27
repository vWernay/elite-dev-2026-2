import { z } from "zod"

export const attributesSchema = z.object({
  set: z.string().optional(),
  rarity: z.string().optional(),
  artist: z.string().optional(),
  typeLine: z.string().optional(),
  releasedAt: z.string().optional(),
  refPriceUsd: z.string().nullable().optional(),
  refPriceEur: z.string().nullable().optional(),
})

export const statusSchema = z.enum(["cancelled", "scheduled", "live", "ended"])

export const lotSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  imageUrl: z.string(),
  attributes: attributesSchema,
  status: statusSchema,
  startingBidCents: z.number(),
  minIncrementCents: z.number(),
  currentBidCents: z.number().nullable(),
  minNextBidCents: z.number(),
  bidCount: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  originalEndsAt: z.string(),
})

export const lotDetailSchema = lotSummarySchema.extend({
  bids: z.array(
    z.object({
      seq: z.number(),
      pseudonym: z.string(),
      amountCents: z.number(),
      createdAt: z.string(),
    }),
  ),
  serverNow: z.string(),
  myPseudonym: z.string().nullable(),
  result: z.object({
    outcome: z.enum(["sold", "unsold", "settling"]).nullable(),
    finalAmountCents: z.number().nullable(),
    receiptId: z.uuid().nullable(),
    winnerPseudonym: z.string().nullable(),
  }),
})

export const auctioneerLotSchema = lotSummarySchema.extend({
  result: z.object({
    outcome: z.enum(["sold", "unsold", "settling"]).nullable(),
    finalAmountCents: z.number().nullable(),
    receiptId: z.uuid().nullable(),
  }),
})

export type LotSummary = z.infer<typeof lotSummarySchema>
