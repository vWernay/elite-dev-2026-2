import argon2 from "argon2"
import { eq } from "drizzle-orm"
import type { FastifyReply } from "fastify"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { db } from "../db/client.js"
import { userRole, users } from "../db/schema.js"
import { env } from "../env.js"
import { AppError } from "../errors.js"
import { authenticate } from "./guards.js"

const COOKIE_NAME = "token"
const SESSION_SECONDS = 7 * 24 * 60 * 60

// Usado para gastar o mesmo tempo de verificação quando o e-mail não existe.
const dummyHash = await argon2.hash("dummy-password")

const email = z.string().trim().toLowerCase().pipe(z.email())

const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(userRole.enumValues),
})

function startSession(
  reply: FastifyReply,
  user: { id: string; role: (typeof userRole.enumValues)[number] },
) {
  const token = reply.server.jwt.sign(
    { sub: user.id, role: user.role },
    { expiresIn: SESSION_SECONDS },
  )
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  })
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === "23505" || e?.cause?.code === "23505"
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/register",
    {
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(100),
          email,
          password: z.string().min(8).max(128),
          role: z.enum(userRole.enumValues),
        }),
        response: { 201: userSchema },
      },
    },
    async (request, reply) => {
      const { name, email, password, role } = request.body
      const passwordHash = await argon2.hash(password)

      try {
        const [user] = await db
          .insert(users)
          .values({ name, email, passwordHash, role })
          .returning({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
          })
        startSession(reply, user)
        return reply.code(201).send(user)
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(
            409,
            "EMAIL_TAKEN",
            "Este e-mail já está cadastrado.",
          )
        }
        throw err
      }
    },
  )

  app.post(
    "/login",
    {
      schema: {
        body: z.object({ email, password: z.string().min(1).max(128) }),
        response: { 200: userSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body
      const [user] = await db.select().from(users).where(eq(users.email, email))

      const valid = await argon2.verify(
        user?.passwordHash ?? dummyHash,
        password,
      )
      if (!user || !valid) {
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "E-mail ou senha inválidos.",
        )
      }

      startSession(reply, user)
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    },
  )

  app.post("/logout", { preHandler: authenticate }, async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" })
    return reply.code(204).send()
  })

  app.get(
    "/me",
    {
      preHandler: authenticate,
      schema: { response: { 200: userSchema } },
    },
    async (request) => {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, request.user.sub))

      if (!user) {
        throw new AppError(401, "UNAUTHENTICATED", "Faça login para continuar.")
      }
      return user
    },
  )
}
