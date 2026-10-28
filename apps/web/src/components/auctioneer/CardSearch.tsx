import {
  Button,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core"
import { useDebouncedCallback } from "@mantine/hooks"
import { IconSearch } from "@tabler/icons-react"
import { keepPreviousData } from "@tanstack/react-query"
import { useState } from "react"
import {
  type GetApiCardsSearch200CardsItem,
  useGetApiCardsSearch,
} from "../../api/generated/api"
import { rarityLabel } from "../../lib/format"
import { EmptyState } from "../EmptyState"
import { ErrorState } from "../ErrorState"
import classes from "./CardSearch.module.css"

export type CardResult = GetApiCardsSearch200CardsItem

type Props = {
  selected: CardResult | null
  onSelect: (card: CardResult) => void
}

export function CardSearch({ selected, onSelect }: Props) {
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)

  const pushQuery = useDebouncedCallback((value: string) => {
    setQ(value.trim())
    setPage(1)
  }, 400)

  const search = useGetApiCardsSearch(
    { q, page },
    {
      query: {
        enabled: q.length >= 2,
        staleTime: 5 * 60_000,
        placeholderData: keepPreviousData,
      },
    },
  )
  const cards = search.data?.data.cards ?? []

  return (
    <Stack gap="md">
      <TextInput
        label="Buscar carta"
        description="Pesquisa no Scryfall, em inglês. Ex.: lightning bolt"
        placeholder="Nome da carta"
        leftSection={<IconSearch size={16} />}
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value)
          pushQuery(event.currentTarget.value)
        }}
      />

      {q.length < 2 ? (
        <Text size="sm" c="dimmed">
          Digite pelo menos 2 letras para buscar.
        </Text>
      ) : search.isPending ? (
        <SimpleGrid cols={{ base: 2, sm: 4, md: 5 }}>
          {Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa de placeholders
            <Skeleton key={i} h={250} />
          ))}
        </SimpleGrid>
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => search.refetch()} />
      ) : cards.length === 0 ? (
        <Paper>
          <EmptyState
            icon={IconSearch}
            title="Nenhuma carta encontrada"
            description={`Nada para "${q}". Tente outro nome.`}
          />
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4, md: 5 }}>
            {cards.map((card) => (
              <UnstyledButton
                key={card.scryfallId}
                className={classes.card}
                data-selected={
                  selected?.scryfallId === card.scryfallId || undefined
                }
                onClick={() => onSelect(card)}
              >
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  h={170}
                  fit="contain"
                />
                <Text size="sm" fw={600} lineClamp={1} mt="xs">
                  {card.name}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {card.set} · {rarityLabel(card.rarity)}
                </Text>
                {card.refPriceUsd && (
                  <Text size="xs" c="dimmed">
                    Referência: US$ {card.refPriceUsd}
                  </Text>
                )}
              </UnstyledButton>
            ))}
          </SimpleGrid>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {search.data?.data.total} resultado(s)
            </Text>
            <Group gap="xs">
              <Button
                variant="default"
                size="xs"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <Text size="sm">Página {page}</Text>
              <Button
                variant="default"
                size="xs"
                disabled={!search.data?.data.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </Group>
          </Group>
        </>
      )}
    </Stack>
  )
}
