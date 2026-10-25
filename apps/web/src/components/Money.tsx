import { Text, type TextProps } from "@mantine/core"
import { formatCents } from "../lib/format"

type Props = TextProps & { cents: number }

// Algarismos de largura fixa: os valores não "pulam" quando o lance muda.
export function Money({ cents, ...props }: Props) {
  return (
    <Text
      component="span"
      inherit
      style={{ fontVariantNumeric: "tabular-nums" }}
      {...props}
    >
      {formatCents(cents)}
    </Text>
  )
}
