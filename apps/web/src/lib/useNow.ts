import { useEffect, useState } from "react"

// Horário atual em ms, atualizado a cada intervalo. Pode passar null para não atualizar
export function useNow(intervalMs: number | null) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (intervalMs === null) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
