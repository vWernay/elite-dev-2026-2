import {
  Grid,
  Group,
  Image,
  Paper,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core"
import { IconArrowLeft } from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"
import { useSession } from "../auth/useSession"
import { ErrorState, NotFound } from "../components/ErrorState"
import { RouterAnchor } from "../components/RouterAnchor"
import { BidHistory } from "../components/room/BidHistory"
import { BidPanel } from "../components/room/BidPanel"
import { LotInfo } from "../components/room/LotInfo"
import classes from "../components/room/LotRoom.module.css"
import { useLotRoom } from "../components/room/useLotRoom"

export const Route = createFileRoute("/lotes/$id")({ component: LotRoom })

function RoomSkeleton() {
  return (
    <Grid gap="xl">
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Skeleton h={420} />
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack>
          <Skeleton h={32} w="60%" />
          <Skeleton h={260} />
          <Skeleton h={160} />
        </Stack>
      </Grid.Col>
    </Grid>
  )
}

function LotRoom() {
  const { id } = Route.useParams()
  const { user } = useSession()
  const { query, lot, now } = useLotRoom(id, user?.role === "bidder")

  if (
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.status === 400)
  )
    return <NotFound />
  if (query.isError && !lot) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }
  if (!lot) return <RoomSkeleton />

  return (
    <Stack gap="lg">
      <RouterAnchor to="/" size="sm" c="dimmed">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          Voltar para a vitrine
        </Group>
      </RouterAnchor>

      <Grid gap="xl">
        <Grid.Col span={{ base: 12, md: 5 }} order={{ base: 2, md: 1 }}>
          <Stack gap="md">
            <Paper className={classes.image}>
              <Image
                src={lot.imageUrl}
                alt={lot.title}
                h={{ base: 340, md: 460 }}
                fit="contain"
              />
            </Paper>
            <LotInfo attributes={lot.attributes} />
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }} order={{ base: 1, md: 2 }}>
          <Stack gap="lg">
            <Title order={1}>{lot.title}</Title>
            <BidPanel lot={lot} now={now} user={user} />
            <Stack gap="xs">
              <Title order={3}>Histórico de lances</Title>
              <Text size="sm" c="dimmed">
                Os licitantes aparecem por um código que muda a cada lote.
              </Text>
              <BidHistory
                bids={lot.bids}
                myPseudonym={user?.role === "bidder" ? lot.myPseudonym : null}
              />
            </Stack>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
