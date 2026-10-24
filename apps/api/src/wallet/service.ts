import { eq, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"
import { AppError } from "../errors.js"
import { committedCents } from "./balance.js"

export const MAX_DEPOSIT_CENTS = 10_000_000

async function snapshot(userId: string, balanceCents: number) {
  const committed = await committedCents(db, userId)
  return {
    balanceCents,
    committedCents: committed,
    availableCents: balanceCents - committed,
  }
}

export async function getWallet(userId: string) {
  const [user] = await db
    .select({ balanceCents: users.balanceCents })
    .from(users)
    .where(eq(users.id, userId))
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Faça login para continuar.")
  return snapshot(userId, user.balanceCents)
}

export async function deposit(userId: string, amountCents: number) {
  // A soma é feita no banco, então depósitos simultâneos não se perdem
  const [user] = await db
    .update(users)
    .set({ balanceCents: sql`${users.balanceCents} + ${amountCents}` })
    .where(eq(users.id, userId))
    .returning({ balanceCents: users.balanceCents })
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Faça login para continuar.")
  return snapshot(userId, user.balanceCents)
}
