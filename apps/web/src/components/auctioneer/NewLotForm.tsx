import {
  Alert,
  Button,
  Checkbox,
  Group,
  Image,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core"
import { DateTimePicker } from "@mantine/dates"
import { useForm } from "@mantine/form"
import { notifications } from "@mantine/notifications"
import { IconAlertCircle } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import { useState } from "react"
import { ApiError } from "../../api/fetcher"
import {
  getGetApiAuctioneerLotsQueryKey,
  getGetApiLotsQueryKey,
  usePostApiLots,
} from "../../api/generated/api"
import { rarityLabel } from "../../lib/format"
import type { CardResult } from "./CardSearch"

const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss"
const money = {
  prefix: "R$ ",
  decimalScale: 2,
  fixedDecimalScale: true,
  decimalSeparator: ",",
  thousandSeparator: ".",
  allowNegative: false,
} as const

const durations = [
  { label: "1 hora", hours: 1 },
  { label: "6 horas", hours: 6 },
  { label: "24 horas", hours: 24 },
  { label: "3 dias", hours: 72 },
]

type Props = {
  card: CardResult
  onChangeCard: () => void
  onCreated: () => void
}

export function NewLotForm({ card, onChangeCard, onCreated }: Props) {
  const queryClient = useQueryClient()
  const create = usePostApiLots()
  const [formError, setFormError] = useState<string | null>(null)

  const suggestion = card.refPriceUsd
    ? Math.max(1, Math.round(Number(card.refPriceUsd)))
    : 10

  const form = useForm({
    mode: "controlled",
    initialValues: {
      startingBid: suggestion as number | string,
      increment: 5 as number | string,
      startNow: true,
      startsAt: dayjs().add(1, "hour").format(DATE_FORMAT),
      endsAt: dayjs().add(24, "hour").format(DATE_FORMAT),
    },
    validate: {
      startingBid: (v) =>
        Number(v) > 0 ? null : "Informe um valor maior que zero",
      increment: (v) =>
        Number(v) > 0 ? null : "Informe um valor maior que zero",
      startsAt: (v, values) =>
        values.startNow || dayjs(v).isAfter(dayjs().subtract(1, "minute"))
          ? null
          : "O início não pode estar no passado",
      endsAt: (v, values) => {
        const start = values.startNow ? dayjs() : dayjs(values.startsAt)
        return dayjs(v).isAfter(start)
          ? null
          : "O fim deve ser depois do início"
      },
    },
  })

  const baseTime = () =>
    form.values.startNow ? dayjs() : dayjs(form.values.startsAt)

  const submit = form.onSubmit((values) => {
    setFormError(null)
    const start = values.startNow ? dayjs() : dayjs(values.startsAt)
    create.mutate(
      {
        data: {
          scryfallId: card.scryfallId,
          startingBidCents: Math.round(Number(values.startingBid) * 100),
          minIncrementCents: Math.round(Number(values.increment) * 100),
          startsAt: start.toISOString(),
          endsAt: dayjs(values.endsAt).toISOString(),
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({
            queryKey: getGetApiAuctioneerLotsQueryKey(),
          })
          queryClient.invalidateQueries({ queryKey: getGetApiLotsQueryKey() })
          notifications.show({
            color: "green",
            title: "Lote criado",
            message: `${res.data.title} já está na vitrine.`,
          })
          onCreated()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "INVALID_SCHEDULE") {
            form.setFieldError("endsAt", err.message)
            return
          }
          setFormError(
            err instanceof ApiError
              ? err.message
              : "Não foi possível falar com o servidor. Tente novamente.",
          )
        },
      },
    )
  })

  return (
    <Paper p="md">
      <form onSubmit={submit} noValidate>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Stack gap="xs" align="center">
            <Image src={card.imageUrl} alt={card.name} h={300} fit="contain" />
            <Text fw={600} ta="center">
              {card.name}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {card.set} · {rarityLabel(card.rarity)}
            </Text>
            <Button variant="default" size="xs" onClick={onChangeCard}>
              Trocar carta
            </Button>
          </Stack>

          <Stack gap="sm">
            {formError && (
              <Alert
                color="red"
                icon={<IconAlertCircle size={18} />}
                title="Não foi possível criar o lote"
              >
                {formError}
              </Alert>
            )}
            <NumberInput
              label="Lance inicial"
              description={
                card.refPriceUsd
                  ? `Sugestão baseada no preço de referência (US$ ${card.refPriceUsd}).`
                  : undefined
              }
              required
              {...money}
              {...form.getInputProps("startingBid")}
            />
            <NumberInput
              label="Incremento mínimo"
              description="Quanto cada lance precisa superar o anterior."
              required
              {...money}
              {...form.getInputProps("increment")}
            />
            <Checkbox
              label="Começar agora"
              {...form.getInputProps("startNow", { type: "checkbox" })}
            />
            {!form.values.startNow && (
              <DateTimePicker
                label="Início"
                valueFormat="DD/MM/YYYY HH:mm"
                minDate={dayjs().format(DATE_FORMAT)}
                required
                {...form.getInputProps("startsAt")}
              />
            )}
            <DateTimePicker
              label="Fim"
              valueFormat="DD/MM/YYYY HH:mm"
              required
              {...form.getInputProps("endsAt")}
            />
            <Group gap="xs">
              {durations.map((d) => (
                <Button
                  key={d.label}
                  variant="light"
                  size="compact-xs"
                  onClick={() =>
                    form.setFieldValue(
                      "endsAt",
                      baseTime().add(d.hours, "hour").format(DATE_FORMAT),
                    )
                  }
                >
                  {d.label}
                </Button>
              ))}
            </Group>
            <Text size="xs" c="dimmed">
              Lances nos últimos 2 minutos prorrogam o fim do leilão.
            </Text>
            <Button type="submit" loading={create.isPending}>
              Publicar lote
            </Button>
          </Stack>
        </SimpleGrid>
      </form>
    </Paper>
  )
}
