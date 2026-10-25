import { Container } from "@mantine/core"
import type { ReactNode } from "react"
import { AppFooter } from "./AppFooter"
import { AppHeader } from "./AppHeader"
import classes from "./AppLayout.module.css"

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={classes.root}>
      <AppHeader />
      <main className={classes.main}>
        <Container py="lg">{children}</Container>
      </main>
      <AppFooter />
    </div>
  )
}
