import { Group, Pagination, Paper, Skeleton, Stack, Text } from "@mantine/core"
import { IconReceipt2 } from "@tabler/icons-react"
import { keepPreviousData } from "@tanstack/react-query"
import { useState } from "react"
import {
  type GetApiWalletEntries200ItemsItem,
  useGetApiWalletEntries,
} from "../../api/generated/api"
import { formatDateTime } from "../../lib/format"
import { EmptyState } from "../EmptyState"
import { ErrorState } from "../ErrorState"
import { Money } from "../Money"
import { RouterAnchor } from "../RouterAnchor"

const PAGE_SIZE = 10

const kindLabel: Record<GetApiWalletEntries200ItemsItem["kind"], string> = {
  opening: "Saldo inicial",
  deposit: "Depósito",
  lot_debit: "Arremate",
  lot_credit: "Venda",
  adjustment: "Ajuste",
}

function Entry({ entry }: { entry: GetApiWalletEntries200ItemsItem }) {
  const incoming = entry.amountCents > 0
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" py="sm">
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={600}>
          {kindLabel[entry.kind]}
        </Text>
        {entry.lotId && (
          <Text size="sm" lineClamp={1}>
            {entry.lotTitle ? (
              <RouterAnchor
                to="/lotes/$id"
                params={{ id: entry.lotId }}
                size="sm"
              >
                {entry.lotTitle}
              </RouterAnchor>
            ) : (
              "Lote removido"
            )}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {formatDateTime(entry.createdAt)}
        </Text>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <Text size="sm" fw={700} c={incoming ? "green" : "red"}>
          {incoming ? "+" : "−"}
          <Money cents={Math.abs(entry.amountCents)} />
        </Text>
        <Text size="xs" c="dimmed">
          Saldo <Money cents={entry.balanceAfterCents} />
        </Text>
      </div>
    </Group>
  )
}

// Extrato da conta: depósitos e arremates (licitante) ou vendas (leiloeiro)
export function Ledger() {
  const [page, setPage] = useState(1)
  const entries = useGetApiWalletEntries(
    { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    { query: { placeholderData: keepPreviousData } },
  )

  if (entries.isPending) return <Skeleton h={200} />
  if (entries.isError) {
    return (
      <ErrorState error={entries.error} onRetry={() => entries.refetch()} />
    )
  }

  const { items, total } = entries.data.data
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (total === 0) {
    return (
      <Paper>
        <EmptyState
          icon={IconReceipt2}
          title="Nenhuma movimentação ainda"
          description="Depósitos, arremates e vendas aparecem aqui."
        />
      </Paper>
    )
  }

  return (
    <Stack gap="md">
      <Paper px="md">
        <Stack gap={0}>
          {items.map((entry, index) => (
            <div
              key={entry.id}
              style={
                index > 0
                  ? {
                      borderTop:
                        "1px solid var(--mantine-color-default-border)",
                    }
                  : undefined
              }
            >
              <Entry entry={entry} />
            </div>
          ))}
        </Stack>
      </Paper>
      {pages > 1 && (
        <Group justify="center">
          <Pagination total={pages} value={page} onChange={setPage} />
        </Group>
      )}
    </Stack>
  )
}
