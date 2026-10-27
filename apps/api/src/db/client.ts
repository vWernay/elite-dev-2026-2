import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { env } from "../env.js"

// O Postgres do Heroku exige SSL, com certificado autoassinado
const useSsl = env.DATABASE_SSL
  ? env.DATABASE_SSL === "true"
  : env.NODE_ENV === "production"

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
})
export const db = drizzle(pool)

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type DbOrTx = typeof db | Tx
