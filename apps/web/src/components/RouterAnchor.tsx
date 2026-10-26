import { Anchor, type AnchorProps } from "@mantine/core"
import { createLink, type LinkComponent } from "@tanstack/react-router"
import { type ComponentPropsWithoutRef, forwardRef } from "react"

type Props = AnchorProps & ComponentPropsWithoutRef<"a">

const MantineAnchor = forwardRef<HTMLAnchorElement, Props>((props, ref) => (
  <Anchor ref={ref} {...props} />
))

const Created = createLink(MantineAnchor)

export const RouterAnchor: LinkComponent<typeof MantineAnchor> = (props) => (
  <Created {...props} />
)
