import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { AppError } from "./errors.js"

const tooMany = (seconds: number) =>
  new AppError(
    429,
    "RATE_LIMITED",
    `Muitas tentativas. Tente de novo em ${seconds} s.`,
    { retryAfterSeconds: seconds },
  )

// Erro do limite global (o plugin lança o que este builder devolve)
export const globalLimitError = (_req: FastifyRequest, ctx: { ttl: number }) =>
  tooMany(Math.ceil(ctx.ttl / 1000))

type Rule = {
  name: string
  max: number
  windowMs: number
  key: (request: FastifyRequest) => string
}

// Limite extra para uma rota. O nome vai na chave para que as regras não se misturem
export function limitBy(app: FastifyInstance, rule: Rule) {
  // sem o plugin (testes), não limita
  if (!app.hasDecorator("createRateLimit")) return async () => {}
  const check = app.createRateLimit({
    max: rule.max,
    timeWindow: rule.windowMs,
    keyGenerator: (request) => `${rule.name}:${rule.key(request)}`,
  })
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await check(request)
    if (result.isAllowed || !result.isExceeded) return
    reply.header("retry-after", result.ttlInSeconds)
    throw tooMany(result.ttlInSeconds)
  }
}
