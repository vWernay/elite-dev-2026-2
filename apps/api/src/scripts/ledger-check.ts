// Confere se o saldo de cada usuário bate com a soma do extrato.
// Uso: pnpm --filter api ledger:check (sai com código 1 se algum não bater)
import { pool } from "../db/client.js"
import { verifyLedger } from "../wallet/ledger.js"

try {
  const mismatches = await verifyLedger()
  if (mismatches.length === 0) {
    console.log("extrato ok: o saldo de todos os usuários bate com a soma")
  } else {
    console.error(
      `${mismatches.length} usuário(s) com saldo diferente do extrato:`,
    )
    for (const m of mismatches) console.error(m)
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
