import { createInterface } from "node:readline"
import { parseArgs } from "node:util"
import { createAccount } from "../auth/accounts.js"
import { pool } from "../db/client.js"

const usage =
  "uso: pnpm --filter api user:create --role auctioneer --email a@b.com --name Nome\n" +
  "A senha vem de NEW_USER_PASSWORD ou é pedida sem aparecer na tela."

// Pergunta a senha sem mostrar o que é digitado
function askPassword(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: true })
    const write = rl as unknown as { _writeToOutput: (s: string) => void }
    process.stdout.write("Senha: ")
    write._writeToOutput = () => {}
    rl.question("", (answer) => {
      rl.close()
      process.stdout.write("\n")
      resolve(answer)
    })
  })
}

const { values } = parseArgs({
  options: {
    role: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
  },
})

try {
  if (!values.role || !values.email || !values.name) {
    console.error(usage)
    process.exitCode = 1
  } else {
    const password = process.env.NEW_USER_PASSWORD ?? (await askPassword())
    const user = await createAccount({
      name: values.name,
      email: values.email,
      password,
      role: values.role as "auctioneer" | "bidder",
    })
    console.log(`usuário criado: ${user.email} (${user.role})`)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await pool.end()
}
