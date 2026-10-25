import { Burger, Container, Drawer, Group, Text } from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { IconGavel } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { ColorSchemeToggle } from "../ColorSchemeToggle"
import classes from "./AppHeader.module.css"
import { navItems } from "./nav"

export function AppHeader() {
  const [opened, { toggle, close }] = useDisclosure(false)

  const links = navItems.map((item) => (
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
        <div className={classes.drawerLinks}>{links}</div>
      </Drawer>
    </header>
  )
}
