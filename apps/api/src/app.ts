import fastifyCookie from "@fastify/cookie"
import fastifyHelmet from "@fastify/helmet"
import fastifyRateLimit from "@fastify/rate-limit"
import fastifyStatic from "@fastify/static"
import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"
import { sql } from "drizzle-orm"
import Fastify, { type FastifyError } from "fastify"
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod"
import { auditRoutes } from "./audit/routes.js"
import { authRoutes } from "./auth/routes.js"
import { bidderRoutes } from "./bidder/routes.js"
import { bidRoutes } from "./bids/routes.js"
import { cardRoutes } from "./cards/routes.js"
import { db } from "./db/client.js"
import { env } from "./env.js"
import { AppError } from "./errors.js"
import { DEFAULT_HEARTBEAT_MS, eventRoutes } from "./events/routes.js"
import { auctioneerRoutes, lotRoutes } from "./lots/routes.js"
import { checkOrigin } from "./origin-check.js"
import { globalLimitError } from "./rate-limit.js"
import { receiptRoutes } from "./receipts/routes.js"
import { walletRoutes } from "./wallet/routes.js"

type AppOptions = {
  sseHeartbeatMs?: number
  webDir?: string
  // Desligado por padrão nos testes, que abrem muitas contas pelo mesmo IP
  rateLimit?: boolean
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    // sem isto, o desligamento esperaria os streams SSE abertos para sempre
    forceCloseConnections: true,
    // Atrás do roteador do Heroku (1 salto): o IP é o último do X-Forwarded-For.
    // Com "true" valeria o primeiro, que o cliente pode forjar para escapar do limite
    trustProxy: (_address, hop) => hop < 1,
  }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // o Mantine injeta estilos em linha
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "https://cards.scryfall.io", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
      },
    },
    // HSTS só em produção: em localhost o navegador não deve fixar HTTPS
    strictTransportSecurity:
      env.NODE_ENV === "production"
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
  })
  if (options.rateLimit ?? env.NODE_ENV !== "test") {
    app.register(fastifyRateLimit, {
      max: 300,
      timeWindow: "1 minute",
      errorResponseBuilder: globalLimitError,
    })
  }
  app.addHook("onRequest", checkOrigin)
  app.register(fastifyCookie)
  // preenchido pelo authenticate
  app.decorateRequest("user", null as never)

  app.register(fastifySwagger, {
    openapi: { info: { title: "Mesa de Lances API", version: "1.0.0" } },
    transform: jsonSchemaTransform,
  })
  // A UI do Swagger usa script e estilo em linha, então tem CSP própria
  app.register(fastifySwaggerUi, {
    routePrefix: "/api/docs",
    staticCSP: true,
    // o bundle do Swagger aplica estilo em linha por script
    transformStaticCSP: (header) => {
      const csp = header.replace(
        "style-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      )
      if (env.NODE_ENV === "production") return csp
      return csp.replace(/;?\s*upgrade-insecure-requests;?/, "")
    },
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

  if (options.webDir) {
    app.register(fastifyStatic, {
      root: options.webDir,
      setHeaders: (reply, path) => {
        // Só os arquivos de /assets/ têm o hash no nome e podem ficar em cache
        // para sempre. O resto (index.html, favicon) é sempre revalidado.
        const hashed = /[\\/]assets[\\/]/.test(path)
        reply.header(
          "Cache-Control",
          hashed ? "public, max-age=31536000, immutable" : "no-cache",
        )
      },
    })
  }

  app.setNotFoundHandler((request, reply) => {
    // Endereço do site (ex.: /lotes/abc): quem responde é o front.
    const wantsPage =
      options.webDir &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      request.headers.accept?.includes("text/html")
    if (wantsPage) return reply.sendFile("index.html")

    return reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } })
  })

  // Dentro de um plugin para o limite global também valer aqui
  app.register(async (scope) => {
    scope.get("/api/health", async () => {
      await db.execute(sql`select 1`)
      return { status: "ok" }
    })
  })

  app.register(authRoutes, { prefix: "/api/auth" })
  app.register(lotRoutes, { prefix: "/api/lots" })
  app.register(bidRoutes, { prefix: "/api/lots" })
  app.register(auditRoutes, { prefix: "/api/lots" })
  app.register(eventRoutes, {
    prefix: "/api/lots",
    heartbeatMs: options.sseHeartbeatMs ?? DEFAULT_HEARTBEAT_MS,
  })
  app.register(auctioneerRoutes, { prefix: "/api/auctioneer" })
  app.register(cardRoutes, { prefix: "/api/cards" })
  app.register(walletRoutes, { prefix: "/api/wallet" })
  app.register(bidderRoutes, { prefix: "/api/bidder" })
  app.register(receiptRoutes, { prefix: "/api/receipts" })

  return app
}
