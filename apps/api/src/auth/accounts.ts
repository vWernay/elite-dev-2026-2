import argon2 from "argon2"
import { z } from "zod"
import { db } from "../db/client.js"
import { userRole, users } from "../db/schema.js"

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

const accountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: z.string().min(8).max(128),
  role: z.enum(userRole.enumValues),
})

// Usado pelo script user:create. O cadastro pela API só cria licitantes
export async function createAccount(input: z.input<typeof accountSchema>) {
  const { password, ...rest } = accountSchema.parse(input)
  const passwordHash = await argon2.hash(password)
  const [user] = await db
    .insert(users)
    .values({ ...rest, passwordHash })
    .returning({ id: users.id, email: users.email, role: users.role })
  return user
}
