import { Text } from "@mantine/core"
import { createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "../components/PageHeader"

export const Route = createFileRoute("/lotes/$id")({ component: LotRoom })

function LotRoom() {
  const { id } = Route.useParams()
  return (
    <>
      <PageHeader title="Sala do lote" />
      <Text c="dimmed">Em construção. Lote {id}</Text>
    </>
  )
}
