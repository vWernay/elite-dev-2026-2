import { Stack, Text, ThemeIcon } from "@mantine/core"
import type { Icon } from "@tabler/icons-react"
import type { ReactNode } from "react"

type Props = {
  icon: Icon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
}: Props) {
  return (
    <Stack align="center" gap="xs" py="xl" ta="center">
      <ThemeIcon variant="light" color="gray" size={48} radius="xl">
        <IconComponent size={24} stroke={1.5} />
      </ThemeIcon>
      <Text fw={600}>{title}</Text>
      {description && (
        <Text c="dimmed" size="sm" maw={380}>
          {description}
        </Text>
      )}
      {action}
    </Stack>
  )
}
