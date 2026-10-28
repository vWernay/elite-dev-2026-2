import {
  Button,
  Group,
  Image,
  Modal,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { IconGavel } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ApiError } from "../../api/fetcher"
import {
  type GetApiAuctioneerLots200LotsItem,
  getGetApiAuctioneerLotsQueryKey,
  getGetApiLotsQueryKey,
  useGetApiAuctioneerLots,
  usePostApiLotsIdCancel,
} from "../../api/generated/api"
import { formatDateTime } from "../../lib/format"
import { EmptyState } from "../EmptyState"
import { ErrorState } from "../ErrorState"
import { Money } from "../Money"
import { RouterButton } from "../RouterButton"
import { StatusBadge } from "../StatusBadge"

type Lot = GetApiAuctioneerLots200LotsItem

function Result({ lot }: { lot: Lot }) {
  const { outcome, finalAmountCents } = lot.result
  if (outcome === "sold" && finalAmountCents !== null) {
    return (
      <Text size="sm">
        Arrematado por <Money cents={finalAmountCents} fw={600} />
      </Text>
    )
  }
  if (outcome === "unsold")
    return (
      <Text size="sm" c="dimmed">
        Sem lances
      </Text>
    )
  if (outcome === "settling")
    return (
      <Text size="sm" c="dimmed">
        Apurando…
      </Text>
    )
  if (lot.status === "cancelled")
    return (
      <Text size="sm" c="dimmed">
        Cancelado
      </Text>
    )
  return (
    <Text size="sm" c="dimmed">
      Em andamento
    </Text>
  )
}

const canCancel = (lot: Lot) =>
  (lot.status === "live" || lot.status === "scheduled") && lot.bidCount === 0

export function Stats({
  lots,
  totalReceivedCents,
}: {
  lots: Lot[]
  totalReceivedCents: number
}) {
  const open = lots.filter(
    (l) => l.status === "live" || l.status === "scheduled",
  ).length
  const sold = lots.filter((l) => l.result.outcome === "sold").length
  const items = [
    {
      label: "Total recebido",
      value: <Money cents={totalReceivedCents} fz={26} fw={700} />,
    },
    {
      label: "Lotes em andamento",
      value: (
        <Text fz={26} fw={700}>
          {open}
        </Text>
      ),
    },
    {
      label: "Lotes arrematados",
      value: (
        <Text fz={26} fw={700}>
          {sold}
        </Text>
      ),
    },
  ]
  return (
    <Group grow align="stretch">
      {items.map((item) => (
        <Paper key={item.label} p="md">
          <Text size="xs" c="dimmed">
            {item.label}
          </Text>
          {item.value}
        </Paper>
      ))}
    </Group>
  )
}

export function MyLots() {
  const queryClient = useQueryClient()
  const lots = useGetApiAuctioneerLots({ query: { refetchInterval: 15_000 } })
  const cancel = usePostApiLotsIdCancel()
  const [toCancel, setToCancel] = useState<Lot | null>(null)

  const confirmCancel = () => {
    if (!toCancel) return
    cancel.mutate(
      { id: toCancel.id },
      {
        onSuccess: () => {
          notifications.show({
            color: "green",
            title: "Lote cancelado",
            message: toCancel.title,
          })
        },
        onError: (err) => {
          notifications.show({
            color: "red",
            title: "Não foi possível cancelar",
            message: err instanceof ApiError ? err.message : "Tente novamente.",
          })
        },
        onSettled: () => {
          setToCancel(null)
          queryClient.invalidateQueries({
            queryKey: getGetApiAuctioneerLotsQueryKey(),
          })
          queryClient.invalidateQueries({ queryKey: getGetApiLotsQueryKey() })
        },
      },
    )
  }

  if (lots.isPending) return <Skeleton h={200} />
  if (lots.isError)
    return <ErrorState error={lots.error} onRetry={() => lots.refetch()} />

  const { lots: items, totalReceivedCents } = lots.data.data

  return (
    <Stack gap="md">
      <Stats lots={items} totalReceivedCents={totalReceivedCents} />

      {items.length === 0 ? (
        <Paper>
          <EmptyState
            icon={IconGavel}
            title="Você ainda não criou lotes"
            description="Busque uma carta acima para publicar o primeiro."
          />
        </Paper>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={780}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Lote</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th ta="right">Lance</Table.Th>
                  <Table.Th ta="right">Lances</Table.Th>
                  <Table.Th>Fim</Table.Th>
                  <Table.Th>Resultado</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((lot) => (
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
                      <StatusBadge status={lot.status} />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money
                        cents={lot.currentBidCents ?? lot.startingBidCents}
                      />
                    </Table.Td>
                    <Table.Td ta="right">{lot.bidCount}</Table.Td>
                    <Table.Td c="dimmed">{formatDateTime(lot.endsAt)}</Table.Td>
                    <Table.Td>
                      <Result lot={lot} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <RouterButton
                          to="/lotes/$id"
                          params={{ id: lot.id }}
                          variant="default"
                          size="compact-sm"
                        >
                          Ver
                        </RouterButton>
                        {canCancel(lot) && (
                          <Button
                            variant="light"
                            color="red"
                            size="compact-sm"
                            onClick={() => setToCancel(lot)}
                          >
                            Cancelar
                          </Button>
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

      <Modal
        opened={toCancel !== null}
        onClose={() => setToCancel(null)}
        title="Cancelar lote?"
        centered
      >
        <Stack>
          <Text size="sm">
            {toCancel?.title} sai da vitrine. Só é possível cancelar enquanto
            não houver lances.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setToCancel(null)}>
              Voltar
            </Button>
            <Button
              color="red"
              loading={cancel.isPending}
              onClick={confirmCancel}
            >
              Cancelar lote
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
