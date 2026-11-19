import { desc, eq, sql } from "drizzle-orm"
import type { DbOrTx } from "../db/client.js"
import { db } from "../db/client.js"
import { lots, walletEntries } from "../db/schema.js"

type NewEntry = typeof walletEntries.$inferInsert

// Chamado na mesma transação que muda users.balance_cents, com o saldo já atualizado
export async function recordEntry(executor: DbOrTx, entry: NewEntry) {
  await executor.insert(walletEntries).values(entry)
}

export async function listEntries(
  userId: string,
  { limit, offset }: { limit: number; offset: number },
) {
  const [items, total] = await Promise.all([
    db
      .select({
        id: walletEntries.id,
        kind: walletEntries.kind,
        amountCents: walletEntries.amountCents,
        balanceAfterCents: walletEntries.balanceAfterCents,
        lotId: walletEntries.lotId,
        lotTitle: lots.title,
        createdAt: walletEntries.createdAt,
      })
      .from(walletEntries)
      .leftJoin(lots, eq(lots.id, walletEntries.lotId))
      .where(eq(walletEntries.userId, userId))
      .orderBy(desc(walletEntries.id))
      .limit(limit)
      .offset(offset),
    db.$count(walletEntries, eq(walletEntries.userId, userId)),
  ])
  return {
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
  }
}

export type LedgerMismatch = {
  userId: string
  balanceCents: number
  entriesSumCents: number
  lastBalanceAfterCents: number | null
}

// Confere, para cada usuário, se saldo = soma do extrato = saldo da última linha.
// Devolve só os que não batem. Não é uma garantia do banco: é uma checagem
export async function verifyLedger(executor: DbOrTx = db) {
  const result = await executor.execute(sql`
    select u.id as "userId",
           u.balance_cents::float8 as "balanceCents",
           coalesce(sum(e.amount_cents), 0)::float8 as "entriesSumCents",
           (select e2.balance_after_cents::float8 from wallet_entries e2
             where e2.user_id = u.id order by e2.id desc limit 1) as "lastBalanceAfterCents"
    from users u
    left join wallet_entries e on e.user_id = u.id
    group by u.id, u.balance_cents
    having u.balance_cents <> coalesce(sum(e.amount_cents), 0)
        or u.balance_cents <> coalesce(
             (select e2.balance_after_cents from wallet_entries e2
               where e2.user_id = u.id order by e2.id desc limit 1), 0)
  `)
  return result.rows as LedgerMismatch[]
}
