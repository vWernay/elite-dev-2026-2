export type LotEvent =
  | {
      type: "bid"
      data: {
        seq: number
        pseudonym: string
        amountCents: number
        createdAt: string
        minNextBidCents: number
        endsAt: string
      }
    }
  | {
      type: "settled"
      data: { receiptId: string | null; winnerPseudonym: string | null }
    }
  | { type: "cancelled"; data: Record<string, never> }

type Listener = (event: LotEvent) => void

// Barramento em memória por lote. Só serve enquanto há um único processo
export function createLotEvents() {
  const listeners = new Map<string, Set<Listener>>()

  function subscribe(lotId: string, listener: Listener) {
    const set = listeners.get(lotId) ?? new Set()
    set.add(listener)
    listeners.set(lotId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(lotId)
    }
  }

  function publish(lotId: string, event: LotEvent) {
    for (const listener of [...(listeners.get(lotId) ?? [])]) {
      // Um cliente com problema não pode atrapalhar os outros nem o lance
      try {
        listener(event)
      } catch {}
    }
  }

  const count = (lotId: string) => listeners.get(lotId)?.size ?? 0

  return { subscribe, publish, count }
}

export const lotEvents = createLotEvents()
