export type SseEvent = { event: string; data: unknown }

// Abre um stream SSE e vai juntando eventos e comentários (": ping")
export async function openStream(url: string) {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  const reader = response.body?.getReader()
  const events: SseEvent[] = []
  const comments: string[] = []
  const state = { ended: false }

  async function pump() {
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let end = buffer.indexOf("\n\n")
        while (end >= 0) {
          parseFrame(buffer.slice(0, end))
          buffer = buffer.slice(end + 2)
          end = buffer.indexOf("\n\n")
        }
      }
    } catch {
      // abortado pelo teste
    } finally {
      state.ended = true
    }
  }

  function parseFrame(frame: string) {
    let name: string | null = null
    let data: string | null = null
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) comments.push(line)
      else if (line.startsWith("event: ")) name = line.slice(7)
      else if (line.startsWith("data: ")) data = line.slice(6)
    }
    if (name && data !== null)
      events.push({ event: name, data: JSON.parse(data) })
  }

  void pump()

  async function waitFor(check: () => boolean, ms = 3_000) {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (check()) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return check()
  }

  return {
    response,
    events,
    comments,
    get ended() {
      return state.ended
    },
    waitFor,
    waitForEvents: (count: number) => waitFor(() => events.length >= count),
    close: () => controller.abort(),
  }
}
