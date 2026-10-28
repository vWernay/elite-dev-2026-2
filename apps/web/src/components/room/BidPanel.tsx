import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Text,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import {
  IconAlertCircle,
  IconCheck,
  IconInfoCircle,
  IconTrophy,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ApiError } from "../../api/fetcher"
import {
  type GetApiLotsId200,
  getGetApiLotsIdQueryKey,
  getGetApiWalletQueryKey,
  useGetApiWallet,
  usePostApiLotsIdBids,
} from "../../api/generated/api"
import type { SessionUser } from "../../auth/session"
import { formatCents, formatCountdown, formatDateTime } from "../../lib/format"
import { Money } from "../Money"
import { RouterAnchor } from "../RouterAnchor"
import { RouterButton } from "../RouterButton"
import { StatusBadge } from "../StatusBadge"
import { bidderLabel } from "./BidHistory"
import { applyBid, type Phase, phaseOf } from "./useLotRoom"

type Props = { lot: GetApiLotsId200; now: number; user: SessionUser | null }

// Últimos 2 minutos: um lance prorroga o leilão
const EXTENSION_MS = 2 * 60 * 1000

function Countdown({
  lot,
  phase,
  now,
}: {
  lot: GetApiLotsId200
  phase: Phase
  now: number
}) {
  if (phase === "cancelled") return null
  if (phase === "ended") {
    return (
      <Text size="sm" c="dimmed">
        Encerrado em {formatDateTime(lot.endsAt)}
      </Text>
    )
  }

  const target = Date.parse(phase === "scheduled" ? lot.startsAt : lot.endsAt)
  const left = target - now
  const urgent = phase === "live" && left < EXTENSION_MS

  return (
    <div>
      <Text size="xs" c="dimmed">
        {phase === "scheduled" ? "Começa em" : "Termina em"}
      </Text>
      <Text
        fz={32}
        fw={700}
        lh={1.1}
        c={urgent ? "orange" : undefined}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatCountdown(left)}
      </Text>
      {phase === "scheduled" && (
        <Text size="sm" c="dimmed">
          Início: {formatDateTime(lot.startsAt)}
        </Text>
      )}
      {urgent && (
        <Text size="xs" c="dimmed" mt={2}>
          Nos últimos 2 minutos, cada lance prorroga o fim para 2 minutos a
          partir dele.
        </Text>
      )}
    </div>
  )
}

function Standing({ lot, mine }: { lot: GetApiLotsId200; mine: string }) {
  const myBids = lot.bids.filter((b) => b.pseudonym === mine)
  if (myBids.length === 0) return null

  const best = Math.max(...myBids.map((b) => b.amountCents))
  const leading = lot.bids[lot.bids.length - 1]?.pseudonym === mine

  return leading ? (
    <Alert
      color="green"
      icon={<IconCheck size={18} />}
      title="Você está ganhando"
    >
      Seu lance de {formatCents(best)} é o maior até agora.
    </Alert>
  ) : (
    <Alert
      color="orange"
      icon={<IconInfoCircle size={18} />}
      title="Você foi superado"
    >
      Seu maior lance foi {formatCents(best)}. O valor já voltou ao seu saldo
      disponível.
    </Alert>
  )
}

function BidForm({ lot }: { lot: GetApiLotsId200 }) {
  const queryClient = useQueryClient()
  const wallet = useGetApiWallet()
  const bid = usePostApiLotsIdBids()
  const min = lot.minNextBidCents
  const [amount, setAmount] = useState<number | string>(min / 100)
  const [error, setError] = useState<string | null>(null)

  // Quando alguém cobre o lance, o mínimo sobe e o campo acompanha
  useEffect(() => {
    setAmount((current) =>
      typeof current === "number" && current >= min / 100 ? current : min / 100,
    )
  }, [min])

  const refreshLot = () =>
    queryClient.invalidateQueries({ queryKey: getGetApiLotsIdQueryKey(lot.id) })

  const submit = () => {
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Informe o valor do lance.")
      return
    }
    setError(null)
    bid.mutate(
      { id: lot.id, data: { amountCents: cents } },
      {
        onSuccess: (res) => {
          applyBid(queryClient, lot.id, {
            ...res.data.bid,
            minNextBidCents: res.data.lot.minNextBidCents,
            endsAt: res.data.lot.endsAt,
          })
          queryClient.invalidateQueries({ queryKey: getGetApiWalletQueryKey() })
          notifications.show({
            color: "green",
            title: "Lance aceito",
            message: `Seu lance de ${formatCents(cents)} está na frente.`,
          })
        },
        onError: (err) => {
          if (!(err instanceof ApiError)) {
            setError("Não foi possível falar com o servidor. Tente novamente.")
            return
          }
          setError(err.message)
          const minimum = err.details?.minimumCents
          if (err.code === "BID_BELOW_MINIMUM" && typeof minimum === "number") {
            setAmount(minimum / 100)
          }
          // O lote pode ter mudado (novo mínimo, início, fim ou cancelamento)
          refreshLot()
        },
      },
    )
  }

  return (
    <Stack gap="xs">
      <NumberInput
        label="Seu lance"
        prefix="R$ "
        decimalScale={2}
        fixedDecimalScale
        decimalSeparator=","
        thousandSeparator="."
        allowNegative={false}
        step={lot.minIncrementCents / 100}
        value={amount}
        onChange={setAmount}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit()
        }}
        description={`Mínimo: ${formatCents(min)}`}
      />
      {wallet.data && (
        <Text size="xs" c="dimmed">
          Saldo disponível:{" "}
          <Money cents={wallet.data.data.availableCents} fw={600} />
        </Text>
      )}
      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title="Lance recusado"
        >
          {error}
        </Alert>
      )}
      <Button onClick={submit} loading={bid.isPending}>
        Dar lance
      </Button>
    </Stack>
  )
}

function Action({
  lot,
  phase,
  user,
}: {
  lot: GetApiLotsId200
  phase: Phase
  user: SessionUser | null
}) {
  const href = useLocation({ select: (l) => l.href })

  if (phase === "scheduled") {
    return (
      <Alert color="blue" icon={<IconInfoCircle size={18} />}>
        Os lances abrem em {formatDateTime(lot.startsAt)}.
      </Alert>
    )
  }
  if (phase !== "live") return null

  if (!user) {
    return (
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          Entre com uma conta de licitante para dar lances.
        </Text>
        <Group grow>
          <RouterButton
            to="/entrar"
            search={{ redirect: href }}
            variant="default"
          >
            Entrar
          </RouterButton>
          <RouterButton to="/cadastro" search={{ redirect: href }}>
            Criar conta
          </RouterButton>
        </Group>
      </Stack>
    )
  }
  if (user.role === "auctioneer") {
    return (
      <Alert color="gray" icon={<IconInfoCircle size={18} />}>
        Leiloeiros não podem dar lances.
      </Alert>
    )
  }
  return <BidForm lot={lot} />
}

function Result({
  lot,
  phase,
  mine,
}: {
  lot: GetApiLotsId200
  phase: Phase
  mine: string | null
}) {
  if (phase === "cancelled") {
    return (
      <Alert
        color="gray"
        icon={<IconInfoCircle size={18} />}
        title="Lote cancelado"
      >
        O leiloeiro cancelou este lote.
        {mine && lot.bids.some((bid) => bid.pseudonym === mine) && (
          <>
            {" "}
            Seus lances deixaram de valer e o valor reservado foi liberado no
            seu saldo.
          </>
        )}
      </Alert>
    )
  }
  if (phase !== "ended") return null

  const { outcome, winnerPseudonym, finalAmountCents } = lot.result
  if (outcome === "unsold") {
    return (
      <Alert
        color="gray"
        icon={<IconInfoCircle size={18} />}
        title="Encerrado sem lances"
      >
        Não houve vencedor.
      </Alert>
    )
  }
  if (outcome === "sold" && winnerPseudonym && finalAmountCents !== null) {
    const won = winnerPseudonym === mine
    const participated = mine && lot.bids.some((b) => b.pseudonym === mine)
    return (
      <Alert
        color={won ? "green" : "gray"}
        icon={<IconTrophy size={18} />}
        title={won ? "Você arrematou este lote!" : "Lote arrematado"}
      >
        {bidderLabel(winnerPseudonym)} por {formatCents(finalAmountCents)}.
        {!won && participated && " Você não arrematou desta vez."}
        {lot.result.receiptId && (
          <Text size="sm" mt={6}>
            <RouterAnchor
              to="/comprovante/$id"
              params={{ id: lot.result.receiptId }}
              size="sm"
            >
              Ver comprovante
            </RouterAnchor>
          </Text>
        )}
      </Alert>
    )
  }
  return (
    <Alert color="blue" icon={<Loader size={16} />} title="Encerrado">
      Apurando o resultado…
    </Alert>
  )
}

export function BidPanel({ lot, now, user }: Props) {
  const phase = phaseOf(lot, now)
  const hasBids = lot.currentBidCents !== null
  const mine = user?.role === "bidder" ? lot.myPseudonym : null

  return (
    <Paper p="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <StatusBadge status={phase} />
          {lot.endsAt !== lot.originalEndsAt && phase !== "ended" && (
            <Badge color="orange">Prorrogado</Badge>
          )}
        </Group>

        <Countdown lot={lot} phase={phase} now={now} />

        <div>
          <Text size="xs" c="dimmed">
            {!hasBids
              ? "Lance inicial"
              : phase === "ended"
                ? "Lance final"
                : phase === "cancelled"
                  ? "Último lance"
                  : "Lance atual"}
          </Text>
          <Money
            cents={lot.currentBidCents ?? lot.startingBidCents}
            fz={28}
            fw={700}
          />
          {(phase === "live" || phase === "scheduled") && (
            <Text size="sm" c="dimmed">
              Próximo lance mínimo: <Money cents={lot.minNextBidCents} />
            </Text>
          )}
        </div>

        {phase === "live" && mine && <Standing lot={lot} mine={mine} />}
        <Action lot={lot} phase={phase} user={user} />
        <Result lot={lot} phase={phase} mine={mine} />
      </Stack>
    </Paper>
  )
}
