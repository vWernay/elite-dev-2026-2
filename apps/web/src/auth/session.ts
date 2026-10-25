import type { QueryClient } from "@tanstack/react-query"
import { redirect } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"
import { getApiAuthMe, getGetApiAuthMeQueryKey } from "../api/generated/api"

export type SessionUser = Awaited<ReturnType<typeof getApiAuthMe>>["data"]
export type Role = SessionUser["role"]

// null quando não há sessão
export async function fetchSession(
  queryClient: QueryClient,
): Promise<SessionUser | null> {
  try {
    const res = await queryClient.fetchQuery({
      queryKey: getGetApiAuthMeQueryKey(),
      queryFn: () => getApiAuthMe(),
      staleTime: 30_000,
    })
    return res.data
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function requireRole(role: Role) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const user = await fetchSession(context.queryClient)
    if (!user || user.role !== role) throw redirect({ to: "/" })
    return { user }
  }
}
