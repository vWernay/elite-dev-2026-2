import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { IconAlertCircle } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ApiError } from "../api/fetcher"
import {
  getGetApiWalletQueryKey,
  useGetApiWallet,
  usePostApiWalletDeposits,
} from "../api/generated/api"
import { requireRole } from "../auth/session"
import { ErrorState } from "../components/ErrorState"
import { Money } from "../components/Money"
import { PageHeader } from "../components/PageHeader"
import { formatCents } from "../lib/format"

export const Route = createFileRoute("/carteira")({
  beforeLoad: requireRole("bidder"),
  component: WalletPage,
})

// Mesmo teto da API (centavos).
const MAX_DEPOSIT = 100_000
const quick = [50, 100, 500, 1_000]

function Balance({
  label,
  hint,
  cents,
  strong,
}: {
  label: string
  hint: string
  cents: number
  strong?: boolean
}) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Money cents={cents} fz={28} fw={700} c={strong ? undefined : "dimmed"} />
      <Text size="xs" c="dimmed" mt={4}>
        {hint}
      </Text>
    </Paper>
  )
}

function DepositForm() {
  const queryClient = useQueryClient()
  const deposit = usePostApiWalletDeposits()
  const [amount, setAmount] = useState<number | string>(100)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor maior que zero.")
      return
    }
    if (value > MAX_DEPOSIT) {
      setError(`O depósito máximo é ${formatCents(MAX_DEPOSIT * 100)} por vez.`)
      return
    }
    setError(null)
    const cents = Math.round(value * 100)
    deposit.mutate(
      { data: { amountCents: cents } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetApiWalletQueryKey() })
          notifications.show({
            color: "green",
            title: "Depósito realizado",
            message: `${formatCents(cents)} adicionados ao seu saldo.`,
          })
        },
        onError: (err) =>
          setError(
            err instanceof ApiError
              ? err.message
              : "Não foi possível falar com o servidor. Tente novamente.",
          ),
      },
    )
  }

  return (
    <Paper p="md">
      <Stack gap="sm">
        <Title order={3}>Depositar</Title>
        <Text size="sm" c="dimmed">
          O depósito é simulado: nenhum valor real é cobrado. Limite de{" "}
          {formatCents(MAX_DEPOSIT * 100)} por vez.
        </Text>
        <NumberInput
          label="Valor do depósito"
          prefix="R$ "
          decimalScale={2}
          fixedDecimalScale
          decimalSeparator=","
          thousandSeparator="."
          allowNegative={false}
          value={amount}
          onChange={setAmount}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
          maw={320}
        />
        <Group gap="xs">
          {quick.map((value) => (
            <Button
              key={value}
              variant="light"
              size="compact-sm"
              onClick={() => setAmount(value)}
            >
              {formatCents(value * 100)}
            </Button>
          ))}
        </Group>
        {error && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={18} />}
            title="Não foi possível depositar"
          >
            {error}
          </Alert>
        )}
        <Group>
          <Button onClick={submit} loading={deposit.isPending}>
            Depositar
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}

function WalletPage() {
  const wallet = useGetApiWallet()

  return (
    <Stack gap="lg">
      <PageHeader
        title="Carteira"
        description="Seu saldo para dar lances. Os valores são simulados."
      />

      {wallet.isPending ? (
        <Skeleton h={130} />
      ) : wallet.isError ? (
        <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} />
      ) : (
        <Group grow align="stretch">
          <Balance
            label="Saldo total"
            hint="Tudo o que você depositou, menos o que já pagou."
            cents={wallet.data.data.balanceCents}
          />
          <Balance
            label="Comprometido"
            hint="Soma dos lances em que você está ganhando agora."
            cents={wallet.data.data.committedCents}
          />
          <Balance
            label="Disponível"
            hint="O que ainda pode usar em novos lances."
            cents={wallet.data.data.availableCents}
            strong
          />
        </Group>
      )}

      <DepositForm />
    </Stack>
  )
}
