import type { FastifyRequest } from "fastify"
import type { userRole } from "../db/schema.js"
import { AppError } from "../errors.js"

export type UserRole = (typeof userRole.enumValues)[number]

export type SessionPayload = { sub: string; role: UserRole }

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: SessionPayload
    user: SessionPayload
  }
}

export async function authenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify()
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Faça login para continuar.")
  }
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
