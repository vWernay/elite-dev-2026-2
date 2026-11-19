import type { FastifyRequest } from "fastify"
import type { userRole } from "../db/schema.js"
import { AppError } from "../errors.js"
import { findSession, SESSION_COOKIE } from "./sessions.js"

export type UserRole = (typeof userRole.enumValues)[number]

export type SessionUser = { sub: string; role: UserRole }

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser
  }
}

async function loadUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  const session = await findSession(token)
  if (!session) return null
  return { sub: session.sub, role: session.role }
}

export async function authenticate(request: FastifyRequest) {
  const user = await loadUser(request)
  if (!user) {
    throw new AppError(401, "UNAUTHENTICATED", "Faça login para continuar.")
  }
  request.user = user
}

// Para rotas públicas que mostram algo a mais quando há sessão
export async function optionalUser(request: FastifyRequest) {
  return loadUser(request)
}

export function requireRole(role: UserRole) {
  return async (request: FastifyRequest) => {
    await authenticate(request)
    if (request.user.role !== role) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Seu perfil não tem permissão para esta ação.",
      )
    }
  }
}
