export type ApiErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message)
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, { ...options, credentials: "include" })
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error ?? { code: "UNKNOWN", message: "Erro inesperado." },
    )
  }
  return { data: body, status: res.status, headers: res.headers } as T
}
