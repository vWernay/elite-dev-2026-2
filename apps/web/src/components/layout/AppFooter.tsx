import { Anchor, Container, Group, Text } from "@mantine/core"
import classes from "./AppFooter.module.css"

export function AppFooter() {
  return (
    <footer className={classes.footer}>
      <Container>
        <Group justify="space-between" py="md" gap="xs">
          <Text size="sm" c="dimmed">
            Casa de Leilões
          </Text>
          <Anchor href="/api/docs" size="sm" c="dimmed" target="_blank">
            Documentação da API
          </Anchor>
        </Group>
      </Container>
    </footer>
  )
}
