import { Text, Title } from "@mantine/core"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <>
      <Title order={1}>Vitrine de lotes</Title>
      <Text c="dimmed" mt="xs">
        Em construção.
      </Text>
    </>
  )
}
