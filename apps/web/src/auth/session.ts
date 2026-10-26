import type { QueryClient } from "@tanstack/react-query"
import { redirect } from "@tanstack/react-router"
import { ApiError } from "../api/fetcher"
import { getApiAuthMe } from "../api/generated/api"

export type SessionUser = Awaited<ReturnType<typeof getApiAuthMe>>["data"]
export type Role = SessionUser["role"]

type GuardArgs = {
  context: { queryClient: QueryClient }
  location: { href: string }
}

// "Sem sessão" é um resultado normal (null). Não tratamos como erro
export const sessionQuery = {
  queryKey: ["session"],
  queryFn: async (): Promise<SessionUser | null> => {
    try {
      return (await getApiAuthMe()).data
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },
  staleTime: 30_000,
  // Sem repetir. Com a API fora do ar, a tela precisa se resolver na hora
  retry: false,
} as const

export const fetchSession = (queryClient: QueryClient) =>
  queryClient.fetchQuery(sessionQuery)

// Sem login, vai para a tela de entrada e volta pra cá depois
export function requireRole(role: Role) {
  return async ({ context, location }: GuardArgs) => {
    const user = await fetchSession(context.queryClient)
    if (!user) {
      throw redirect({ to: "/entrar", search: { redirect: location.href } })
    }
    if (user.role !== role) throw redirect({ to: "/" })
    return { user }
  }
}

// Telas de entrar e cadastrar não fazem sentido para quem já está logado
export async function requireGuest({ context }: Pick<GuardArgs, "context">) {
  const user = await fetchSession(context.queryClient).catch(() => null)
  if (user) throw redirect({ to: "/" })
}

// Só aceita caminho do próprio site, para o parâmetro não virar redirecionamento aberto
export function safeRedirect(target: string | undefined) {
  if (target?.startsWith("/") && !target.startsWith("//")) return target
  return "/"
}

// Depois de entrar ou cadastrar, guarda o usuário e descarta o resto do cache
export function setSession(queryClient: QueryClient, user: SessionUser) {
  queryClient.removeQueries({
    predicate: (q) => q.queryKey[0] !== sessionQuery.queryKey[0],
  })
  queryClient.setQueryData(sessionQuery.queryKey, user)
}

// Depois de sair, volta tudo ao estado inicial; a sessão recarrega como null
export function clearSession(queryClient: QueryClient) {
  return queryClient.resetQueries()
}
