import {
  Alert,
  Code,
  Group,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core"
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"
import {
  type GetApiLotsIdAudit200,
  useGetApiLotsIdAudit,
} from "../api/generated/api"
import { EmptyState } from "../components/EmptyState"
import { ErrorState, NotFound } from "../components/ErrorState"
import { Money } from "../components/Money"
import { RouterAnchor } from "../components/RouterAnchor"
import { bidderLabel } from "../components/room/BidHistory"
import { StatusBadge } from "../components/StatusBadge"
import { formatTime } from "../lib/format"

// O "_" depois de $id tira esta página de dentro da sala do lote.
export const Route = createFileRoute("/lotes/$id_/auditoria")({
  component: AuditPage,
})

const issueText: Record<GetApiLotsIdAudit200["issues"][number], string> = {
  COUNT_MISMATCH:
    "A quantidade de lances não confere com a registrada no lote.",
  HEAD_MISMATCH: "A ponta da cadeia de lances não confere.",
  LOT_STATE_MISMATCH:
    "O lance atual ou o líder do lote não confere com o último lance.",
}

function Verdict({ audit }: { audit: GetApiLotsIdAudit200 }) {
  if (audit.verdict === "intact") {
    return (
      <Alert color="green" icon={<IconShieldCheck size={20} />} title="Íntegro">
        Nenhum lance foi alterado, removido ou inserido depois de gravado.
      </Alert>
    )
  }
  if (audit.verdict === "truncated") {
    return (
      <Alert
        color="red"
        icon={<IconAlertTriangle size={20} />}
        title="Lances removidos do final"
      >
        Os lances que aparecem são autênticos, mas há lances registrados que
        sumiram do final do histórico.
      </Alert>
    )
  }
  return (
    <Alert
      color="red"
      icon={<IconAlertTriangle size={20} />}
      title={
        audit.firstInvalidSeq !== null
          ? `Adulterado no lance #${audit.firstInvalidSeq}`
          : "Adulterado"
      }
    >
      O histórico foi modificado fora do sistema.
    </Alert>
  )
}

function AuditPage() {
  const { id } = Route.useParams()
  const audit = useGetApiLotsIdAudit(id)

  if (
    audit.error instanceof ApiError &&
    (audit.error.status === 404 || audit.error.status === 400)
  ) {
    return <NotFound />
  }
  if (audit.isError) {
    return <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
  }
  if (audit.isPending) return <Skeleton h={360} />

  const a = audit.data.data

  return (
    <Stack gap="lg">
      <RouterAnchor to="/lotes/$id" params={{ id }} size="sm" c="dimmed">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          Voltar para o lote
        </Group>
      </RouterAnchor>

      <div>
        <Title order={1}>Auditoria do histórico</Title>
        <Group gap="xs" mt={4}>
          <Text c="dimmed">{a.title}</Text>
          <StatusBadge status={a.status} />
        </Group>
      </div>

      <Verdict audit={a} />

      {a.issues.length > 0 && (
        <Stack gap={4}>
          {a.issues.map((issue) => (
            <Text key={issue} size="sm" c="red">
              • {issueText[issue]}
            </Text>
          ))}
        </Stack>
      )}

      <Paper p="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" c="dimmed">
            Impressão digital da cadeia (igual à do comprovante)
          </Text>
          <Code>{a.fingerprint}</Code>
        </Group>
      </Paper>

      {a.bids.length === 0 ? (
        <Paper>
          <EmptyState icon={IconShieldCheck} title="Nenhum lance neste lote" />
        </Paper>
      ) : (
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
                <Table.Th ta="center">Confere</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {a.bids.map((bid) => (
                <Table.Tr
                  key={bid.seq}
                  bg={bid.valid ? undefined : "var(--mantine-color-red-light)"}
                >
                  <Table.Td>{bid.seq}</Table.Td>
                  <Table.Td>{bidderLabel(bid.pseudonym)}</Table.Td>
                  <Table.Td ta="right">
                    <Money cents={bid.amountCents} />
                  </Table.Td>
                  <Table.Td ta="right" c="dimmed" visibleFrom="xs">
                    {formatTime(bid.createdAt)}
                  </Table.Td>
                  <Table.Td ta="center">
                    <ThemeIcon
                      size="sm"
                      radius="xl"
                      variant="light"
                      color={bid.valid ? "green" : "red"}
                      aria-label={bid.valid ? "Confere" : "Não confere"}
                    >
                      {bid.valid ? (
                        <IconCheck size={12} />
                      ) : (
                        <IconX size={12} />
                      )}
                    </ThemeIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Paper p="md">
        <Stack gap={6}>
          <Text fw={600}>Como a verificação funciona</Text>
          <Text size="sm" c="dimmed">
            Cada lance recebe um código calculado com o valor, o licitante, o
            horário e o código do lance anterior, usando uma chave que só o
            servidor conhece. Se alguém alterar, apagar ou inserir um lance
            direto no banco de dados, a cadeia deixa de bater e esta página
            aponta o primeiro lance afetado.
          </Text>
          <Text size="sm" c="dimmed">
            A impressão digital resume a cadeia inteira. Guarde a do seu
            comprovante: se ela mudar, o histórico mudou.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  )
}
