import { createTheme, rem } from "@mantine/core"

export const theme = createTheme({
  primaryColor: "blue",
  primaryShade: { light: 7, dark: 5 },
  defaultRadius: "md",
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontSize: rem(28), lineHeight: "1.25" },
      h2: { fontSize: rem(22), lineHeight: "1.3" },
      h3: { fontSize: rem(18), lineHeight: "1.35" },
    },
  },
  components: {
    Container: { defaultProps: { size: "lg" } },
    Card: { defaultProps: { withBorder: true, padding: "md" } },
    Paper: { defaultProps: { withBorder: true } },
    Badge: { defaultProps: { variant: "light" } },
    Button: { defaultProps: { fw: 500 } },
  },
})

export const lotStatusColor = {
  live: "red",
  scheduled: "blue",
  ended: "gray",
  cancelled: "gray",
} as const

export const bidStateColor = {
  leading: "green",
  outbid: "orange",
  won: "green",
  lost: "gray",
  cancelled: "gray",
} as const
