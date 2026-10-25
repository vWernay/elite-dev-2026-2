import { writeFileSync } from "node:fs"
import { buildApp } from "./app.js"
import { pool } from "./db/client.js"

const out = process.argv[2] ?? "openapi.json"

const app = buildApp()
await app.ready()
writeFileSync(out, `${JSON.stringify(app.swagger(), null, 2)}\n`)
await app.close()
await pool.end()
