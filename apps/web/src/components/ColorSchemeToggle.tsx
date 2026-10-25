import {
  ActionIcon,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core"
import { IconMoon, IconSun } from "@tabler/icons-react"

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const scheme = useComputedColorScheme("light")

  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label="Alternar tema"
      onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
    >
      {scheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  )
}
