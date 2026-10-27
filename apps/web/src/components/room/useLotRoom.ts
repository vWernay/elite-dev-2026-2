import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import {
  type GetApiLotsId200,
  getGetApiLotsIdQueryKey,
  getGetApiWalletQueryKey,
  useGetApiLotsId,
} from "../../api/generated/api"
import { useNow } from "../../lib/useNow"

type Cached = { data: GetApiLotsId200; status: number; headers: Headers }

// Intervalo da releitura de segurança, igual ao do ping do servidor
const SAFETY_REFETCH_MS = 20_000

export type RoomBid = {
  seq: number
  pseudonym: string
  amountCents: number
  createdAt: string
  minNextBidCents: number
  endsAt: string
}

// Aplica um lance ao cache. Vale para o evento do SSE e para a resposta do
// próprio lance, então ignora o que já foi aplicado (mesmo seq)
export function applyBid(
  queryClient: QueryClient,
  lotId: string,
  bid: RoomBid,
) {
  queryClient.setQueryData<Cached>(getGetApiLotsIdQueryKey(lotId), (old) => {
    if (!old || old.data.bids.some((b) => b.seq === bid.seq)) return old
    return {
      ...old,
      data: {
        ...old.data,
        bids: [
          ...old.data.bids,
          {
            seq: bid.seq,
            pseudonym: bid.pseudonym,
            amountCents: bid.amountCents,
            createdAt: bid.createdAt,
          },
        ],
        currentBidCents: bid.amountCents,
        bidCount: bid.seq,
        minNextBidCents: bid.minNextBidCents,
        endsAt: bid.endsAt,
      },
    }
  })
}

export type Phase = "cancelled" | "scheduled" | "live" | "ended"

export function phaseOf(lot: GetApiLotsId200, now: number): Phase {
  if (lot.status === "cancelled") return "cancelled"
  if (now < Date.parse(lot.startsAt)) return "scheduled"
  if (now < Date.parse(lot.endsAt)) return "live"
  return "ended"
}

// Consulta do lote, atualizada ao vivo pelo SSE, e o relógio do servidor
export function useLotRoom(id: string, isBidder: boolean) {
  const queryClient = useQueryClient()
  const query = useGetApiLotsId(id, {
    query: {
      refetchOnWindowFocus: true,
      // Rede de segurança: o SSE pode ficar mudo sem avisar (proxy, rede ruim),
      // e o navegador não vê os pings. Reler o estado de tempos em tempos
      // garante que nada fique para trás
      refetchInterval: (q) => {
        const lot = q.state.data?.data
        if (!lot) return false
        if (lot.result.outcome === "settling") return 3_000
        return lot.result.outcome === null && lot.status !== "cancelled"
          ? SAFETY_REFETCH_MS
          : false
      },
    },
  })

  // O papel do usuário só é conhecido depois da sessão; um ref evita reabrir
  // a conexão quando ele chega
  const isBidderRef = useRef(isBidder)
  isBidderRef.current = isBidder

  useEffect(() => {
    const lotKey = getGetApiLotsIdQueryKey(id)
    const refreshWallet = () =>
      queryClient.invalidateQueries({ queryKey: getGetApiWalletQueryKey() })
    const source = new EventSource(`/api/lots/${id}/events`)

    // A cada conexão (inclusive reconexão) busca o estado de novo, para
    // recuperar o que passou enquanto estava desconectado
    source.addEventListener("open", () => {
      queryClient.invalidateQueries({ queryKey: lotKey })
    })
    source.addEventListener("bid", (event) => {
      applyBid(queryClient, id, JSON.parse(event.data))
      if (isBidderRef.current) refreshWallet()
    })
    source.addEventListener("settled", () => {
      queryClient.invalidateQueries({ queryKey: lotKey })
      refreshWallet()
    })
    source.addEventListener("cancelled", () => {
      queryClient.setQueryData<Cached>(
        lotKey,
        (old) => old && { ...old, data: { ...old.data, status: "cancelled" } },
      )
    })
    return () => source.close()
  }, [id, queryClient])

  // Diferença entre o relógio do servidor e o deste navegador
  const serverNow = query.data?.data.serverNow
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (serverNow) setOffset(Date.parse(serverNow) - Date.now())
  }, [serverNow])

  const now = useNow(500) + offset
  const lot = query.data?.data

  // No instante em que o fim passa, busca o estado novo (o resultado ainda
  // está vazio no cache) em vez de esperar o evento de liquidação
  const needsResult = lot
    ? phaseOf(lot, now) === "ended" && lot.result.outcome === null
    : false
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando passa a precisar do resultado
  useEffect(() => {
    if (needsResult) query.refetch()
  }, [needsResult])

  return { query, lot, now }
}
