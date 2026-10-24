import type { FastifyBaseLogger } from "fastify"
import { type SettleResult, settleDueLots } from "./service.js"

type Options = {
  logger: FastifyBaseLogger
  intervalMs?: number
  clock?: () => Date
  onSettled?: (results: SettleResult[]) => void
}

export function startSettlementWorker(options: Options) {
  const { logger, intervalMs = 2_000, clock, onSettled } = options
  let running: Promise<void> | null = null

  async function tick() {
    try {
      const results = await settleDueLots(clock)
      for (const result of results) {
        if (result.outcome === "tampered") {
          logger.warn(
            { lotId: result.lotId },
            "lote com cadeia adulterada, não liquidado",
          )
        } else if (result.outcome === "failed") {
          logger.error(
            { lotId: result.lotId, err: result.error },
            "falha ao liquidar lote",
          )
        }
      }
      onSettled?.(results)
    } catch (err) {
      logger.error({ err }, "falha no worker de liquidação")
    }
  }

  const timer = setInterval(() => {
    // Um ciclo lento não vai empilhar outro por cima
    if (running) return
    running = tick().finally(() => {
      running = null
    })
  }, intervalMs)

  return {
    async stop() {
      clearInterval(timer)
      await running
    },
  }
}
