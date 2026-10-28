import { Button, Group, Menu, Text } from "@mantine/core"
import {
  IconChevronDown,
  IconLogout,
  IconUserCircle,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import { useGetApiWallet, usePostApiAuthLogout } from "../../api/generated/api"
import { clearSession, type SessionUser } from "../../auth/session"
import { Money } from "../Money"
import { RouterAnchor } from "../RouterAnchor"
import { roleLabel } from "./nav"

export function useLogout() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const logout = usePostApiAuthLogout()

  // Mesmo que a chamada falhe (cookie já expirado), a sessão local é limpa
  const run = () =>
    logout.mutate(undefined, {
      onSettled: async () => {
        await clearSession(queryClient)
        await router.navigate({ to: "/" })
      },
    })
  return { logout: run, isPending: logout.isPending }
}

export function GuestActions({ fullWidth }: { fullWidth?: boolean }) {
  return (
    <Group gap="xs" grow={fullWidth}>
      <Button component={Link} to="/entrar" variant="default" size="sm">
        Entrar
      </Button>
      <Button component={Link} to="/cadastro" size="sm">
        Criar conta
      </Button>
    </Group>
  )
}

// Saldo disponível, só para licitante
export function HeaderBalance() {
  const { data } = useGetApiWallet({ query: { staleTime: 10_000 } })
  if (!data) return null
  return (
    <RouterAnchor to="/carteira" size="sm" c="dimmed" underline="never">
      Disponível{" "}
      <Money
        cents={data.data.availableCents}
        fw={600}
        c="var(--mantine-color-text)"
      />
    </RouterAnchor>
  )
}

export function UserMenu({ user }: { user: SessionUser }) {
  const { logout, isPending } = useLogout()
  const firstName = user.name.split(" ")[0]

  return (
    <Menu position="bottom-end" width={240}>
      <Menu.Target>
        <Button
          variant="default"
          size="sm"
          leftSection={<IconUserCircle size={18} />}
          rightSection={<IconChevronDown size={14} />}
        >
          {firstName}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={600} c="var(--mantine-color-text)" truncate>
            {user.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {user.email}
          </Text>
          <Text size="xs" c="dimmed">
            {roleLabel[user.role]}
          </Text>
        </Menu.Label>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconLogout size={16} />}
          onClick={logout}
          disabled={isPending}
        >
          Sair
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
