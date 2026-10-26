import { ApiError } from "../api/fetcher"

// Leva o erro da API para o campo certo. Devolve a mensagem geral quando não há campo para mostrá-la
export function applyApiError(
  error: unknown,
  setFieldError: (field: string, message: string) => void,
): string | null {
  if (!(error instanceof ApiError)) {
    return "Não foi possível falar com o servidor. Tente novamente."
  }
  if (error.code === "EMAIL_TAKEN") {
    setFieldError("email", error.message)
    return null
  }
  if (error.code === "VALIDATION_ERROR") {
    const issues = (error.details?.issues ?? []) as { path: string }[]
    for (const issue of issues) {
      setFieldError(issue.path.replace(/^\//, ""), "Valor inválido")
    }
    return null
  }
  return error.message
}
