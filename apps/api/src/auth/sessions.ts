import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull, lt } from "drizzle-orm"
import type { FastifyReply } from "fastify"
import { db } from "../db/client.js"
import { sessions, users } from "../db/schema.js"
import { env } from "../env.js"

export const SESSION_SECONDS = 7 * 24 * 60 * 60

// O prefixo __Host- exige Secure e Path=/, então só vale em produção (HTTPS)
export const SESSION_COOKIE =
  env.NODE_ENV === "production" ? "__Host-token" : "token"

// O banco guarda só o hash: um vazamento da tabela não entrega sessões válidas
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url")
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
  })
  // Limpa as sessões vencidas deste usuário
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())))
  return token
}

export async function findSession(token: string) {
  const id = hashToken(token)
  const [row] = await db
    .select({ sessionId: sessions.id, sub: users.id, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
  return row ?? null
}

export async function revokeSession(token: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, hashToken(token)), isNull(sessions.revokedAt)))
}

export async function startSession(reply: FastifyReply, userId: string) {
  const token = await createSession(userId)
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  })
}

export function endSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  })
}
