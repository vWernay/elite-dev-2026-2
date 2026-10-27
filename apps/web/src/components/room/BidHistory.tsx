import { Badge, Group, Paper, Table, Text } from "@mantine/core"
import { IconGavel } from "@tabler/icons-react"
import { formatTime } from "../../lib/format"
import { EmptyState } from "../EmptyState"
import { Money } from "../Money"

type Bid = {
  seq: number
  pseudonym: string
  amountCents: number
  createdAt: string
}

export const bidderLabel = (pseudonym: string) => `Licitante #${pseudonym}`

export function BidHistory({
  bids,
  myPseudonym,
}: {
  bids: Bid[]
  myPseudonym: string | null
}) {
  if (bids.length === 0) {
    return (
      <Paper>
        <EmptyState
          icon={IconGavel}
          title="Nenhum lance ainda"
          description="O primeiro lance precisa ser pelo menos o valor inicial."
        />
      </Paper>
    )
  }

  const rows = [...bids].sort((a, b) => b.seq - a.seq)

  return (
    <Paper>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={60}>#</Table.Th>
            <Table.Th>Licitante</Table.Th>
            <Table.Th ta="right">Valor</Table.Th>
            <Table.Th ta="right" visibleFrom="xs">
              Horário
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((bid) => (
            <Table.Tr key={bid.seq}>
              <Table.Td>{bid.seq}</Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm">{bidderLabel(bid.pseudonym)}</Text>
                  {bid.pseudonym === myPseudonym && (
                    <Badge size="sm" color="blue">
                      Você
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td ta="right">
                <Money
                  cents={bid.amountCents}
                  fw={bid.seq === bids.length ? 600 : 400}
                />
              </Table.Td>
              <Table.Td ta="right" c="dimmed" visibleFrom="xs">
                {formatTime(bid.createdAt)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}
