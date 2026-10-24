import { buildApp } from "./app.js"
import { pool } from "./db/client.js"
import { env } from "./env.js"
import { startSettlementWorker } from "./settlement/worker.js"

const app = buildApp()
let worker: ReturnType<typeof startSettlementWorker> | undefined

async function shutdown() {
  await worker?.stop()
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => {
    worker = startSettlementWorker({ logger: app.log })
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
