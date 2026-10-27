import { Button, type ButtonProps } from "@mantine/core"
import { createLink, type LinkComponent } from "@tanstack/react-router"
import { type ComponentPropsWithoutRef, forwardRef } from "react"

type Props = ButtonProps & ComponentPropsWithoutRef<"a">

const MantineButton = forwardRef<HTMLAnchorElement, Props>((props, ref) => (
  <Button component="a" ref={ref} {...props} />
))

const Created = createLink(MantineButton)

// Button do Mantine com as rotas tipadas (to, search, params)
export const RouterButton: LinkComponent<typeof MantineButton> = (props) => (
  <Created {...props} />
)
