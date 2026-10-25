import { Badge, type BadgeProps } from "@mantine/core"
import { lotStatusColor } from "../theme"

type LotStatus = keyof typeof lotStatusColor

const labels: Record<LotStatus, string> = {
  live: "Ao vivo",
  scheduled: "Agendado",
  ended: "Encerrado",
  cancelled: "Cancelado",
}

export function StatusBadge({
  status,
  ...props
}: BadgeProps & { status: LotStatus }) {
  return (
    <Badge color={lotStatusColor[status]} {...props}>
      {labels[status]}
    </Badge>
  )
}
