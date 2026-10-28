import { Stack, Title } from "@mantine/core"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { requireRole } from "../auth/session"
import {
  type CardResult,
  CardSearch,
} from "../components/auctioneer/CardSearch"
import { MyLots } from "../components/auctioneer/MyLots"
import { NewLotForm } from "../components/auctioneer/NewLotForm"
import { PageHeader } from "../components/PageHeader"

export const Route = createFileRoute("/painel")({
  beforeLoad: requireRole("auctioneer"),
  component: AuctioneerPanel,
})

function AuctioneerPanel() {
  const [card, setCard] = useState<CardResult | null>(null)

  return (
    <Stack gap="xl">
      <PageHeader
        title="Painel do leiloeiro"
        description="Crie lotes a partir de cartas do Scryfall e acompanhe os resultados."
      />

      <Stack gap="sm">
        <Title order={3}>Novo lote</Title>
        {card ? (
          <NewLotForm
            card={card}
            onChangeCard={() => setCard(null)}
            onCreated={() => setCard(null)}
          />
        ) : (
          <CardSearch selected={card} onSelect={setCard} />
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={3}>Meus lotes</Title>
        <MyLots />
      </Stack>
    </Stack>
  )
}
