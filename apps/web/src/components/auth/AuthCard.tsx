import { Container, Paper, Text, Title } from "@mantine/core"
import type { ReactNode } from "react"

type Props = {
  title: string
  subtitle: ReactNode
  children: ReactNode
}

export function AuthCard({ title, subtitle, children }: Props) {
  return (
    <Container size={420} my={40}>
      <Title order={1} ta="center">
        {title}
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        {subtitle}
      </Text>
      <Paper p={22} mt={30}>
        {children}
      </Paper>
    </Container>
  )
}
