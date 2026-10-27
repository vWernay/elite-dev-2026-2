const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export const formatCents = (cents: number) => brl.format(cents / 100)

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))

// "2d 4h", "3h 12min", "12min 30s", "45s"
export function formatTimeLeft(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}min`
  if (minutes > 0) return `${minutes}min ${String(seconds).padStart(2, "0")}s`
  return `${seconds}s`
}

const rarities: Record<string, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Rara",
  mythic: "Mítica",
  special: "Especial",
  bonus: "Bônus",
}

export const rarityLabel = (rarity: string) => rarities[rarity] ?? rarity

const time = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

export const formatTime = (iso: string) => time.format(new Date(iso))

// Contagem da sala: sempre com segundos, para ver o tempo correndo
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")

  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}min`
  if (hours > 0) return `${hours}h ${pad(minutes)}min ${pad(seconds)}s`
  if (minutes > 0) return `${minutes}min ${pad(seconds)}s`
  return `${seconds}s`
}
