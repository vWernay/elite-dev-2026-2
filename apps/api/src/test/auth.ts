import type { FastifyInstance } from "fastify"

export async function signUp(
  app: FastifyInstance,
  role: "bidder" | "auctioneer",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: "Teste",
      email: `${role}@teste.com`,
      password: "senha12345",
      role,
    },
  })
  const { id } = response.json()
  const cookie = response.cookies.find((c) => c.name === "token")
  return { id: id as string, cookies: { token: cookie?.value ?? "" } }
}
