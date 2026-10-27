import { Alert, Button, Container, Stack, Text, Title } from "@mantine/core"
import { IconAlertCircle } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"

function messageOf(error: unknown) {
  // UNKNOWN: a resposta não veio no formato da API (servidor fora do ar, proxy).
  if (error instanceof ApiError && error.code !== "UNKNOWN")
    return error.message
  return "Não foi possível falar com o servidor. Tente novamente em instantes."
}

// Para falhas de consulta dentro de uma tela
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  return (
    <Alert
      color="red"
      icon={<IconAlertCircle size={18} />}
      title="Não foi possível carregar"
    >
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{messageOf(error)}</Text>
        {onRetry && (
          <Button size="xs" variant="default" onClick={onRetry}>
            Tentar de novo
          </Button>
        )}
      </Stack>
    </Alert>
  )
}

// Página inteira. Rota que não existe
export function NotFound() {
  return (
    <Container size="xs" py={80} ta="center">
      <Text c="dimmed" fw={700} fz={56}>
        404
      </Text>
      <Title order={2} mt="xs">
        Página não encontrada
      </Title>
      <Text c="dimmed" mt="sm">
        O endereço não existe ou o lote foi removido.
      </Text>
      <Button component={Link} to="/" variant="default" mt="lg">
        Voltar para a vitrine
      </Button>
    </Container>
  )
}

// Página inteira. Erro inesperado numa rota.
export function RouteError({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  return (
    <Container size="xs" py={80}>
      <ErrorState error={error} onRetry={reset} />
    </Container>
  )
}
