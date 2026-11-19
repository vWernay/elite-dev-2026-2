import { randomUUID } from "node:crypto"
import argon2 from "argon2"
import type { FastifyInstance } from "fastify"
import { db } from "../db/client.js"
import { users } from "../db/schema.js"

const PASSWORD = "senha12345"
const passwordHash = await argon2.hash(PASSWORD)

// Licitante: cadastro pela API. Leiloeiro: criado direto no banco (o cadastro
// público não aceita esse papel), depois entra pelo login.
export async function signUp(
  app: FastifyInstance,
  role: "bidder" | "auctioneer",
  email = `${role}@teste.com`,
) {
  if (role === "bidder") {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Teste", email, password: PASSWORD },
    })
    const { id } = response.json()
    const cookie = response.cookies.find((c) => c.name === "token")
    return { id: id as string, cookies: { token: cookie?.value ?? "" } }
  }

  const id = randomUUID()
  await db
    .insert(users)
    .values({ id, name: "Teste", email, passwordHash, role })
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PASSWORD },
  })
  const cookie = response.cookies.find((c) => c.name === "token")
  return { id, cookies: { token: cookie?.value ?? "" } }
}
