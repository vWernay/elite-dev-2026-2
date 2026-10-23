import { desc, eq } from "drizzle-orm"
import { chain } from "../audit/index.js"
import { db } from "../db/client.js"
import { bids, lots, users } from "../db/schema.js"
import { AppError } from "../errors.js"
import { committedCents } from "../wallet/balance.js"
import {
  assertAboveMinimum,
  assertBiddable,
  assertFunds,
  extendedEndsAt,
  minimumBidCents,
} from "./rules.js"

type PlaceBidInput = { lotId: string; bidderId: string; amountCents: number }

// O relógio é injetável para os testes controlarem o horário.
export async function placeBid(
  input: PlaceBidInput,
  clock: () => Date = () => new Date(),
) {
  const { lotId, bidderId, amountCents } = input

  return db.transaction(async (tx) => {
    // Ordem de locks: lote primeiro, depois o licitante.
    const [lot] = await tx
      .select()
      .from(lots)
      .where(eq(lots.id, lotId))
      .for("update")
    if (!lot) throw new AppError(404, "NOT_FOUND", "Lote não encontrado.")

    // O horário é lido depois do lock, para o lance usar a hora em que foi aceito.
    const now = clock()
    assertBiddable(lot, bidderId, now)
    assertAboveMinimum(lot, amountCents)

    const [bidder] = await tx
      .select({ balanceCents: users.balanceCents })
      .from(users)
      .where(eq(users.id, bidderId))
      .for("update")
    if (!bidder)
      throw new AppError(401, "UNAUTHENTICATED", "Usuário não encontrado.")

    // Calculado depois do lock do usuário, para enxergar lances concorrentes.
    assertFunds(
      amountCents,
      bidder.balanceCents,
      await committedCents(tx, bidderId),
    )

    const [previous] = await tx
      .select({ mac: bids.mac })
      .from(bids)
      .where(eq(bids.lotId, lotId))
      .orderBy(desc(bids.seq))
      .limit(1)

    const data = {
      seq: lot.bidCount + 1,
      bidderId,
      amountCents,
      createdAt: now,
    }
    const mac = chain.bidMac(lotId, data, previous?.mac ?? chain.genesis(lot))
    await tx.insert(bids).values({ lotId, ...data, mac })

    const endsAt = extendedEndsAt(lot.endsAt, now)
    const updated = {
      currentBidCents: amountCents,
      leaderId: bidderId,
      bidCount: data.seq,
      headMac: chain.headMac(lotId, data.seq, mac),
      endsAt,
    }
    await tx.update(lots).set(updated).where(eq(lots.id, lotId))

    return {
      bid: {
        seq: data.seq,
        pseudonym: chain.pseudonym(lotId, bidderId),
        amountCents,
        createdAt: now,
      },
      lot: {
        currentBidCents: amountCents,
        bidCount: data.seq,
        minNextBidCents: minimumBidCents({ ...lot, ...updated }),
        endsAt,
        extended: endsAt > lot.endsAt,
      },
    }
  })
}
