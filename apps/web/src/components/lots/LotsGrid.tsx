import { Card, Grid, Skeleton, Stack } from "@mantine/core"
import type { GetApiLots200ItemsItem } from "../../api/generated/api"
import { LotCard } from "../LotCard"
import { RouterButton } from "../RouterButton"

const columns = { base: 12, xs: 6, md: 4, lg: 3 }

export function LotsGrid({
  items,
  now,
}: {
  items: GetApiLots200ItemsItem[]
  now: number
}) {
  return (
    <Grid>
      {items.map((lot) => (
        <Grid.Col key={lot.id} span={columns}>
          <LotCard
            now={now}
            lot={{
              title: lot.title,
              imageUrl: lot.imageUrl,
              status: lot.status,
              set: lot.attributes.set,
              rarity: lot.attributes.rarity,
              startingBidCents: lot.startingBidCents,
              currentBidCents: lot.currentBidCents,
              bidCount: lot.bidCount,
              startsAt: lot.startsAt,
              endsAt: lot.endsAt,
            }}
            action={
              <RouterButton
                to="/lotes/$id"
                params={{ id: lot.id }}
                variant="light"
                fullWidth
              >
                Ver lote
              </RouterButton>
            }
          />
        </Grid.Col>
      ))}
    </Grid>
  )
}

export function LotsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Grid>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa de placeholders
        <Grid.Col key={i} span={columns}>
          <Card>
            <Card.Section>
              <Skeleton h={304} radius={0} />
            </Card.Section>
            <Stack gap="xs" mt="md">
              <Skeleton h={18} w="70%" />
              <Skeleton h={14} w="40%" />
              <Skeleton h={28} w="55%" mt="xs" />
              <Skeleton h={14} />
              <Skeleton h={36} />
            </Stack>
          </Card>
        </Grid.Col>
      ))}
    </Grid>
  )
}
