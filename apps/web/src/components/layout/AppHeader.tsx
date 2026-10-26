import {
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  Group,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { IconGavel, IconLogout } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { useSession } from "../../auth/useSession"
import { ColorSchemeToggle } from "../ColorSchemeToggle"
import {
  GuestActions,
  HeaderBalance,
  UserMenu,
  useLogout,
} from "./AccountActions"
import classes from "./AppHeader.module.css"
import { navItems, roleLabel } from "./nav"

export function AppHeader() {
  const [opened, { toggle, close }] = useDisclosure(false)
  const { user, isLoading } = useSession()
  const { logout } = useLogout()

  const links = navItems
    .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
    .map((item) => (
      <Link
        key={item.to}
        to={item.to}
        className={classes.link}
        activeOptions={{ exact: item.to === "/" }}
        onClick={close}
      >
        {item.label}
      </Link>
    ))

  return (
    <header className={classes.header}>
      <Container className={classes.inner}>
        <Group gap="lg">
          <Link to="/" className={classes.brand}>
            <IconGavel size={22} stroke={1.75} />
            <Text component="span" fw={700} fz="lg" inherit>
              Casa de Leilões
            </Text>
          </Link>
          <Group gap={4} visibleFrom="sm">
            {links}
          </Group>
        </Group>

        <Group gap="xs">
          <Group gap="md" visibleFrom="sm">
            {isLoading ? (
              <Skeleton h={30} w={190} />
            ) : user ? (
              <>
                {user.role === "bidder" && <HeaderBalance />}
                <UserMenu user={user} />
              </>
            ) : (
              <GuestActions />
            )}
          </Group>
          <ColorSchemeToggle />
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label="Abrir menu"
          />
        </Group>
      </Container>

      <Drawer
        opened={opened}
        onClose={close}
        size="xs"
        padding="md"
        title="Menu"
        hiddenFrom="sm"
      >
        <Stack gap="md">
          <div className={classes.drawerLinks}>{links}</div>
          <Divider />
          {isLoading ? (
            <Skeleton h={36} />
          ) : user ? (
            <Stack gap="sm">
              <div>
                <Text fw={600}>{user.name}</Text>
                <Text size="sm" c="dimmed">
                  {user.email} · {roleLabel[user.role]}
                </Text>
              </div>
              {user.role === "bidder" && <HeaderBalance />}
              <Button
                variant="default"
                leftSection={<IconLogout size={16} />}
                onClick={() => {
                  close()
                  logout()
                }}
              >
                Sair
              </Button>
            </Stack>
          ) : (
            <GuestActions fullWidth />
          )}
        </Stack>
      </Drawer>
    </header>
  )
}
