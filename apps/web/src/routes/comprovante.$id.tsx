import {
  Alert,
  Button,
  Code,
  Container,
  Divider,
  Group,
  Image,
  Paper,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core"
import { IconCheck, IconPrinter, IconShieldX } from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"
import { useGetApiReceiptsId } from "../api/generated/api"
import { ErrorState, NotFound } from "../components/ErrorState"
import { Money } from "../components/Money"
import { RouterButton } from "../components/RouterButton"
import { bidderLabel } from "../components/room/BidHistory"
import { ShareLink } from "../components/ShareLink"
import { formatDateTime, rarityLabel } from "../lib/format"

export const Route = createFileRoute("/comprovante/$id")({
  component: ReceiptPage,
})

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right">
        {children}
      </Text>
    </Group>
  )
}

function ReceiptPage() {
  const { id } = Route.useParams()
  const receipt = useGetApiReceiptsId(id)

  if (
    receipt.error instanceof ApiError &&
    (receipt.error.status === 404 || receipt.error.status === 400)
  ) {
    return <NotFound />
  }
  if (receipt.isError) {
    return (
      <ErrorState error={receipt.error} onRetry={() => receipt.refetch()} />
    )
  }
  if (receipt.isPending) {
    return (
      <Container size="sm">
        <Skeleton h={420} />
      </Container>
    )
  }

  const r = receipt.data.data

  return (
    <Container size="sm">
      <Stack gap="lg">
        <div>
          <Title order={1}>Comprovante de arremate</Title>
          <Text c="dimmed">
            Emitido em {formatDateTime(r.issuedAt)}. Qualquer pessoa com o link
            pode conferir.
          </Text>
        </div>

        <Paper p="lg">
          <Stack gap="md">
            <Group wrap="nowrap" align="flex-start">
              <Image
                src={r.lot.imageUrl}
                alt={r.lot.title}
                w={120}
                fit="contain"
              />
              <Stack gap={4}>
                <Title order={3}>{r.lot.title}</Title>
                <Text size="sm" c="dimmed">
                  {[
                    r.lot.attributes.set,
                    r.lot.attributes.rarity &&
                      rarityLabel(r.lot.attributes.rarity),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {r.lot.attributes.artist && (
                  <Text size="sm" c="dimmed">
                    Artista: {r.lot.attributes.artist}
                  </Text>
                )}
              </Stack>
            </Group>

            <Divider />

            <Stack gap="xs">
              <Row label="Valor do arremate">
                <Money cents={r.amountCents} fw={700} fz="lg" />
              </Row>
              <Row label="Arrematante">{bidderLabel(r.winnerPseudonym)}</Row>
              <Row label="Impressão digital da cadeia">
                <Code>{r.fingerprint}</Code>
              </Row>
            </Stack>

            {r.chainValid ? (
              <Alert
                color="green"
                icon={<IconCheck size={18} />}
                title="Histórico íntegro"
              >
                O comprovante confere com o histórico de lances, que não foi
                alterado.
              </Alert>
            ) : (
              <Alert
                color="red"
                icon={<IconShieldX size={18} />}
                title="Não confere"
              >
                Este comprovante não bate com o histórico de lances. Veja a
                auditoria do lote.
              </Alert>
            )}
          </Stack>
        </Paper>

        <ShareLink
          label="Link de compartilhamento"
          path={`/comprovante/${r.id}`}
        />

        <Group>
          <RouterButton
            to="/lotes/$id/auditoria"
            params={{ id: r.lot.id }}
            variant="default"
          >
            Auditar o histórico de lances
          </RouterButton>
          <Button
            variant="subtle"
            leftSection={<IconPrinter size={16} />}
            onClick={() => window.print()}
          >
            Imprimir
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
