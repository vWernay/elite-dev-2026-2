import fastifyCookie from "@fastify/cookie"
import fastifyJwt from "@fastify/jwt"
import { sql } from "drizzle-orm"
import Fastify, { type FastifyError } from "fastify"
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod"
import { authRoutes } from "./auth/routes.js"
import { db } from "./db/client.js"
import { env } from "./env.js"
import { AppError } from "./errors.js"

export function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.register(fastifyCookie)
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "token", signed: false },
  })

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      })
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: {
            issues: err.validation.map((v) => ({
              path: v.instancePath,
              message: v.message,
            })),
          },
        },
      })
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: "BAD_REQUEST", message: err.message },
      })
    }
    request.log.error(err)
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." },
    })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } }),
  )

  app.get("/api/health", async () => {
    await db.execute(sql`select 1`)
    return { status: "ok" }
  })

  app.register(authRoutes, { prefix: "/api/auth" })

  return app
}
