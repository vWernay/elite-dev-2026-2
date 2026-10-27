import { z } from "zod"

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUDIT_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),
  WEB_DIST_DIR: z.string().optional(),
})

export const env = schema.parse(process.env)
