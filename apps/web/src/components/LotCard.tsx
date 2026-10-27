import { Card, Group, Image, Stack, Text } from "@mantine/core"
import type { ReactNode } from "react"
import { formatDateTime, formatTimeLeft, rarityLabel } from "../lib/format"
import classes from "./LotCard.module.css"
import { Money } from "./Money"
import { StatusBadge } from "./StatusBadge"

export type LotCardData = {
  title: string
  imageUrl: string
  status: "live" | "scheduled" | "ended" | "cancelled"
  set?: string
  rarity?: string
  startingBidCents: number
  currentBidCents: number | null
  bidCount: number
  startsAt: string
  endsAt: string
}

type Props = {
  lot: LotCardData
  // horário atual em ms; quem usa o card controla a contagem
  now: number
  action?: ReactNode
}

function timeLine(lot: LotCardData, now: number) {
  if (lot.status === "live") {
    const left = new Date(lot.endsAt).getTime() - now
    return left > 0 ? `Termina em ${formatTimeLeft(left)}` : "Encerrando..."
  }
  if (lot.status === "scheduled") {
    return `Começa em ${formatTimeLeft(new Date(lot.startsAt).getTime() - now)}`
  }
  return `Encerrado em ${formatDateTime(lot.endsAt)}`
}

export function LotCard({ lot, now, action }: Props) {
  const hasBids = lot.currentBidCents !== null
  const details = [lot.set, lot.rarity && rarityLabel(lot.rarity)]
    .filter(Boolean)
    .join(" · ")

  return (
    <Card>
      <Card.Section className={classes.image}>
        <Image src={lot.imageUrl} alt={lot.title} h={280} fit="contain" />
      </Card.Section>

      <Stack gap="xs" mt="md">
        <div>
          <Text fw={600} lineClamp={1}>
            {lot.title}
          </Text>
          {details && (
            <Text size="sm" c="dimmed" lineClamp={1}>
              {details}
            </Text>
          )}
        </div>

        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <div>
            <Text size="xs" c="dimmed">
              {hasBids ? "Lance atual" : "Lance inicial"}
            </Text>
            <Money
              cents={lot.currentBidCents ?? lot.startingBidCents}
              fz="xl"
              fw={700}
            />
          </div>
          <StatusBadge status={lot.status} />
        </Group>

        <Group justify="space-between" gap="xs">
          <Text size="sm" c="dimmed">
            {timeLine(lot, now)}
          </Text>
          <Text size="sm" c="dimmed">
            {lot.bidCount === 1 ? "1 lance" : `${lot.bidCount} lances`}
          </Text>
        </Group>

        {action}
      </Stack>
    </Card>
  )
}
