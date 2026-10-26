import { useQuery } from "@tanstack/react-query"
import { sessionQuery } from "./session"

// user fica null sem login. isLoading vale só até a primeira resposta (com sucesso ou erro); depois nunca volta, mesmo que a busca se repita.
export function useSession() {
  const { data, isFetched } = useQuery(sessionQuery)
  return { user: data ?? null, isLoading: !isFetched }
}
