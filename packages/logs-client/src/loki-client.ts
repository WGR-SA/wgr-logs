import type {
  AlertInstance,
  LokiClientOptions,
  LokiPushPayload,
  LokiQueryRangeResponse,
  LokiStream,
  QueryRangeOptions
} from './types.js'

export class LokiClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly basicAuth?: { username: string; password: string }
  private readonly fetchImpl: typeof fetch
  private readonly defaultLimit: number

  constructor(options: LokiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.basicAuth = options.basicAuth
    // fetch needs `this === window` in browsers; bind to globalThis so we can hold a reference.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.defaultLimit = options.defaultLimit ?? 1000
  }

  async push(streams: LokiStream[]): Promise<void> {
    const payload: LokiPushPayload = { streams }
    const res = await this.fetchImpl(`${this.baseUrl}/loki/api/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      throw new LokiError(`push failed: ${res.status} ${res.statusText}`, res.status, await res.text())
    }
  }

  async pushLine(stream: Record<string, string>, line: string, timestamp: Date = new Date()): Promise<void> {
    const ts = `${timestamp.getTime() * 1_000_000}`
    return this.push([{ stream, values: [[ts, line]] }])
  }

  async query(query: string, time?: Date | number): Promise<LokiQueryRangeResponse> {
    const params = new URLSearchParams({ query })
    if (time !== undefined) params.set('time', toNs(time))
    const res = await this.fetchImpl(`${this.baseUrl}/loki/api/v1/query?${params}`, {
      method: 'GET',
      headers: this.authHeaders()
    })
    if (!res.ok) {
      throw new LokiError(`query failed: ${res.status} ${res.statusText}`, res.status, await res.text())
    }
    return (await res.json()) as LokiQueryRangeResponse
  }

  async queryRange(options: QueryRangeOptions): Promise<LokiQueryRangeResponse> {
    const params = new URLSearchParams({
      query: options.query,
      limit: String(options.limit ?? this.defaultLimit),
      direction: options.direction ?? 'backward'
    })
    if (options.start !== undefined) params.set('start', toNs(options.start))
    if (options.end !== undefined) params.set('end', toNs(options.end))
    if (options.step !== undefined) params.set('step', options.step)

    const res = await this.fetchImpl(`${this.baseUrl}/loki/api/v1/query_range?${params}`, {
      method: 'GET',
      headers: this.authHeaders()
    })
    if (!res.ok) {
      throw new LokiError(`queryRange failed: ${res.status} ${res.statusText}`, res.status, await res.text())
    }
    return (await res.json()) as LokiQueryRangeResponse
  }

  async labels(start?: Date | number, end?: Date | number): Promise<string[]> {
    const params = new URLSearchParams()
    if (start !== undefined) params.set('start', toNs(start))
    if (end !== undefined) params.set('end', toNs(end))
    const url = `${this.baseUrl}/loki/api/v1/labels${params.toString() ? `?${params}` : ''}`
    const res = await this.fetchImpl(url, { headers: this.authHeaders() })
    if (!res.ok) throw new LokiError(`labels failed: ${res.status}`, res.status, await res.text())
    const json = (await res.json()) as { data: string[] }
    return json.data
  }

  async labelValues(name: string, start?: Date | number, end?: Date | number): Promise<string[]> {
    const params = new URLSearchParams()
    if (start !== undefined) params.set('start', toNs(start))
    if (end !== undefined) params.set('end', toNs(end))
    const url = `${this.baseUrl}/loki/api/v1/label/${encodeURIComponent(name)}/values${params.toString() ? `?${params}` : ''}`
    const res = await this.fetchImpl(url, { headers: this.authHeaders() })
    if (!res.ok) throw new LokiError(`labelValues failed: ${res.status}`, res.status, await res.text())
    const json = (await res.json()) as { data: string[] }
    return json.data
  }

  /** Build a websocket URL for `/loki/api/v1/tail` to consume from the desktop app. */
  tailUrl(query: string, opts: { limit?: number; delayFor?: number } = {}): string {
    const ws = this.baseUrl.replace(/^http/, 'ws')
    const params = new URLSearchParams({ query })
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    if (opts.delayFor !== undefined) params.set('delay_for', String(opts.delayFor))
    return `${ws}/loki/api/v1/tail?${params}`
  }

  /** Reads currently active alert instances from Grafana Alertmanager. */
  async activeAlerts(grafanaBaseUrl: string): Promise<AlertInstance[]> {
    const res = await this.fetchImpl(`${grafanaBaseUrl.replace(/\/$/, '')}/api/alertmanager/grafana/api/v2/alerts`, {
      headers: this.authHeaders()
    })
    if (!res.ok) throw new LokiError(`activeAlerts failed: ${res.status}`, res.status, await res.text())
    const json = (await res.json()) as Array<{
      fingerprint: string
      labels: Record<string, string>
      annotations: Record<string, string>
      startsAt?: string
      status: { state: string }
    }>
    return json.map((a) => ({
      fingerprint: a.fingerprint,
      state: (a.status.state as AlertInstance['state']) ?? 'normal',
      labels: a.labels,
      annotations: a.annotations,
      activeAt: a.startsAt
    }))
  }

  private authHeaders(): Record<string, string> {
    if (this.token) return { Authorization: `Bearer ${this.token}` }
    if (this.basicAuth) {
      const encoded = encode(`${this.basicAuth.username}:${this.basicAuth.password}`)
      return { Authorization: `Basic ${encoded}` }
    }
    return {}
  }
}

export class LokiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: string) {
    super(message)
    this.name = 'LokiError'
  }
}

function toNs(value: Date | number | string): string {
  if (typeof value === 'string') return value
  const ms = value instanceof Date ? value.getTime() : value
  return `${ms * 1_000_000}`
}

function encode(input: string): string {
  return btoa(input)
}
