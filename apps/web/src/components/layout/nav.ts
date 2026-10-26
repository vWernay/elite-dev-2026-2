import type { LinkProps } from "@tanstack/react-router"
import type { Role } from "../../auth/session"

export type NavItem = {
  to: NonNullable<LinkProps["to"]>
  label: string
  // sem roles, o item aparece para todos
  roles?: Role[]
}

export const navItems: NavItem[] = [{ to: "/", label: "Vitrine" }]

export const roleLabel: Record<Role, string> = {
  bidder: "Licitante",
  auctioneer: "Leiloeiro",
}
