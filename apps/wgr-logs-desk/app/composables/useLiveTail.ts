interface TailEntry {
  ts: string
  line: string
  labels: Record<string, string>
}

const MAX_LINES = 5000

export function useLiveTail(query: Ref<string>) {
  const entries = ref<TailEntry[]>([])
  const connected = ref(false)
  const error = ref<string | null>(null)
  let socket: WebSocket | null = null

  function close() {
    if (socket) {
      socket.close()
      socket = null
    }
    connected.value = false
  }

  function connect() {
    close()
    const client = useLokiClient()
    if (!client) {
      error.value = 'Configurer endpoint + token dans Réglages'
      return
    }
    if (!query.value.trim()) return

    try {
      socket = new WebSocket(client.tailUrl(query.value, { delayFor: 1 }))
      socket.onopen = () => {
        connected.value = true
        error.value = null
      }
      socket.onerror = () => { error.value = 'Connexion tail échouée' }
      socket.onclose = () => { connected.value = false }
      socket.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data) as {
            streams?: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>
          }
          const fresh: TailEntry[] = []
          for (const s of payload.streams ?? []) {
            for (const [ts, line] of s.values) fresh.push({ ts, line, labels: s.stream })
          }
          if (fresh.length === 0) return
          const merged = [...fresh, ...entries.value]
          entries.value = merged.slice(0, MAX_LINES)
        } catch (e) {
          console.warn('[tail] parse failed', e)
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  watch(query, () => connect())
  onMounted(connect)
  onBeforeUnmount(close)

  return {
    entries: readonly(entries),
    connected: readonly(connected),
    error: readonly(error),
    reconnect: connect,
    clear: () => { entries.value = [] }
  }
}
