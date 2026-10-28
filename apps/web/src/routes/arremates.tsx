import {
  Badge,
  Group,
  Image,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core"
import { IconGavel } from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import {
  type GetApiBidderLots200LotsItem,
  useGetApiBidderLots,
} from "../api/generated/api"
import { requireRole } from "../auth/session"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Money } from "../components/Money"
import { PageHeader } from "../components/PageHeader"
import { RouterButton } from "../components/RouterButton"
import { formatDateTime } from "../lib/format"
import { bidStateColor } from "../theme"

export const Route = createFileRoute("/arremates")({
  beforeLoad: requireRole("bidder"),
  component: MyBidsPage,
})

type Lot = GetApiBidderLots200LotsItem

const stateLabel = {
  leading: "Liderando",
  outbid: "Superado",
  won: "Arrematado",
  lost: "Perdido",
} as const

const filters = {
  all: "Todos",
  ongoing: "Em disputa",
  won: "Arrematados",
  lost: "Perdidos",
} as const

type Filter = keyof typeof filters

const matches = (lot: Lot, filter: Filter) =>
  filter === "all" ||
  (filter === "ongoing" &&
    (lot.state === "leading" || lot.state === "outbid")) ||
  (filter === "won" && lot.state === "won") ||
  (filter === "lost" && lot.state === "lost")

function MyBidsPage() {
  const bids = useGetApiBidderLots({ query: { refetchInterval: 15_000 } })
  const [filter, setFilter] = useState<Filter>("all")

  const lots = (bids.data?.data.lots ?? []).filter((lot) =>
    matches(lot, filter),
  )

  return (
    <Stack gap="lg">
      <PageHeader
        title="Meus arremates"
        description="Os lotes em que você deu lance e os que arrematou."
      />

      <SegmentedControl
        value={filter}
        onChange={(value) => setFilter(value as Filter)}
        data={Object.entries(filters).map(([value, label]) => ({
          value,
          label,
        }))}
        w="fit-content"
        maw="100%"
      />

      {bids.isPending ? (
        <Skeleton h={220} />
      ) : bids.isError ? (
        <ErrorState error={bids.error} onRetry={() => bids.refetch()} />
      ) : lots.length === 0 ? (
        <Paper>
          <EmptyState
            icon={IconGavel}
            title={
              filter === "all"
                ? "Você ainda não deu lances"
                : "Nada por aqui neste filtro"
            }
            description="Quando você der lances, os lotes aparecem aqui."
            action={
              <RouterButton to="/" variant="default">
                Ver a vitrine
              </RouterButton>
            }
          />
        </Paper>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Lote</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th ta="right">Meu maior lance</Table.Th>
                  <Table.Th ta="right">Lance atual</Table.Th>
                  <Table.Th>Fim</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lots.map((lot) => (
                  <Table.Tr key={lot.id}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <Image
                          src={lot.imageUrl}
                          alt=""
                          w={36}
                          h={50}
                          fit="contain"
                        />
                        <div>
                          <Text size="sm" fw={600} lineClamp={1}>
                            {lot.title}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {lot.attributes.set}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={bidStateColor[lot.state]}>
                        {stateLabel[lot.state]}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money cents={lot.myHighestBidCents} />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money
                        cents={lot.currentBidCents ?? lot.startingBidCents}
                      />
                    </Table.Td>
                    <Table.Td c="dimmed">{formatDateTime(lot.endsAt)}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <RouterButton
                          to="/lotes/$id"
                          params={{ id: lot.id }}
                          variant="default"
                          size="compact-sm"
                        >
                          Ver lote
                        </RouterButton>
                        {lot.receiptId && (
                          <RouterButton
                            to="/comprovante/$id"
                            params={{ id: lot.receiptId }}
                            size="compact-sm"
                          >
                            Comprovante
                          </RouterButton>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  )
}
