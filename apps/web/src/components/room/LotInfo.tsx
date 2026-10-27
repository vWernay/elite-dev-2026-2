import { Paper, SimpleGrid, Text } from "@mantine/core"
import type { ReactNode } from "react"
import type { GetApiLotsId200 } from "../../api/generated/api"
import { rarityLabel } from "../../lib/format"

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" })

function usd(value: string) {
  const number = Number(value)
  if (Number.isNaN(number)) return null
  return `US$ ${number.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </div>
  )
}

// Atributos da carta, copiados do Scryfall na criação do lote
export function LotInfo({
  attributes,
}: {
  attributes: GetApiLotsId200["attributes"]
}) {
  const reference = attributes.refPriceUsd ? usd(attributes.refPriceUsd) : null

  return (
    <Paper p="md">
      <SimpleGrid cols={2} spacing="sm">
        {attributes.set && <Item label="Coleção">{attributes.set}</Item>}
        {attributes.rarity && (
          <Item label="Raridade">{rarityLabel(attributes.rarity)}</Item>
        )}
        {attributes.artist && <Item label="Artista">{attributes.artist}</Item>}
        {attributes.releasedAt && (
          <Item label="Lançamento">
            {date.format(new Date(`${attributes.releasedAt}T00:00:00`))}
          </Item>
        )}
        {attributes.typeLine && <Item label="Tipo">{attributes.typeLine}</Item>}
        {reference && <Item label="Preço de referência">{reference}</Item>}
      </SimpleGrid>
    </Paper>
  )
}
