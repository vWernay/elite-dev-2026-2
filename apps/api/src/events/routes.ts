import { eq } from "drizzle-orm"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { db } from "../db/client.js"
import { lots } from "../db/schema.js"
import { AppError } from "../errors.js"
import { type LotEvent, lotEvents } from "./bus.js"

type Options = { heartbeatMs: number }

// Heroku fecha conexões paradas por volta de 55s, então o ping vai antes disso
export const DEFAULT_HEARTBEAT_MS = 20_000

export const eventRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  options,
) => {
  app.get(
    "/:id/events",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const lotId = request.params.id
      const [lot] = await db
        .select({ id: lots.id })
        .from(lots)
        .where(eq(lots.id, lotId))
      if (!lot) throw new AppError(404, "NOT_FOUND", "Lote não encontrado.")

      reply.hijack()
      const res = reply.raw
      request.raw.socket.setNoDelay(true)
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // evita que proxies segurem a resposta em buffer
        "X-Accel-Buffering": "no",
      })
      res.write("retry: 3000\n: connected\n\n")

      const write = (chunk: string) => {
        if (!res.destroyed && !res.writableEnded) res.write(chunk)
      }
      const send = (event: LotEvent) =>
        write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)

      const unsubscribe = lotEvents.subscribe(lotId, send)
      const heartbeat = setInterval(
        () => write(": ping\n\n"),
        options.heartbeatMs,
      )

      const cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
      }
      request.raw.on("close", cleanup)
      res.on("error", cleanup)

      return reply
    },
  )
}
