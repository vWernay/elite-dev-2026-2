import type { FastifyRequest } from "fastify"
import { AppError } from "./errors.js"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

// Reforço ao SameSite=Lax: um POST vindo de outro site é recusado.
// Sem o header Origin (curl, outros clientes que não são navegador), a requisição passa
export async function checkOrigin(request: FastifyRequest) {
  if (SAFE_METHODS.has(request.method)) return
  const origin = request.headers.origin
  if (origin === undefined) return

  let sameSite = false
  try {
    sameSite = new URL(origin).host === request.headers.host
  } catch {
    // Origin inválido ou "null"
  }
  if (!sameSite) {
    throw new AppError(
      403,
      "FORBIDDEN_ORIGIN",
      "Requisição de origem não permitida.",
    )
  }
}
