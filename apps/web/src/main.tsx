import "@mantine/core/styles.css"
import "@mantine/dates/styles.css"
import "@mantine/notifications/styles.css"

import { MantineProvider } from "@mantine/core"
import { DatesProvider } from "@mantine/dates"
import { Notifications } from "@mantine/notifications"
import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import "dayjs/locale/pt-br"
import ReactDOM from "react-dom/client"
import { NotFound, RouteError } from "./components/ErrorState"
import { queryClient } from "./query-client"
import { routeTree } from "./routeTree.gen"
import { theme } from "./theme"

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById("app")

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: "pt-br" }}>
        <Notifications position="top-right" />
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>,
  )
}
