import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { TEST_DATABASE_URL } from "./config.js"

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL)
  const dbName = url.pathname.slice(1)
  if (!dbName.endsWith("_test")) {
    throw new Error(`O banco de testes deve terminar em _test: ${dbName}`)
  }

  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = "/postgres"
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  const found = await admin.query(
    "select 1 from pg_database where datname = $1",
    [dbName],
  )
  if (found.rowCount === 0) await admin.query(`create database "${dbName}"`)
  await admin.end()

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL })
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" })
  await pool.end()
}
