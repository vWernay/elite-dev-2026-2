import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "./api/fetcher"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // erro 4xx não melhora com nova tentativa
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})
