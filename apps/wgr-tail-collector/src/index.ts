/**
 * wgr-tail-collector
 *
 * Cloudflare Tail Worker. Receives TraceItem[] events from other Workers
 * that list this Worker as a `tail_consumers` entry, and forwards each
 * event as Loki log lines.
 *
 * Each source Worker becomes a `app=<scriptName>` label.
 * Events are batched per call (Cloudflare delivers batches up to ~100 events).
 */

export interface Env {
  WGR_INGEST_URL: string
  WGR_INGEST_USER: string
  WGR_INGEST_TOKEN: string  // secret
  WGR_ENV: string
  WGR_CLUSTER: string
}

interface LokiStream {
  stream: Record<string, string>
  values: Array<[timestampNs: string, line: string]>
}

export default {
  async tail(events: TraceItem[], env: Env, ctx: ExecutionContext): Promise<void> {
    if (events.length === 0) return

    // Group log entries by (scriptName, outcome) — each becomes its own stream
    const streams = new Map<string, LokiStream>()

    for (const event of events) {
      const app = event.scriptName ?? 'unknown'
      const outcome = event.outcome ?? 'unknown'  // ok | exception | exceededCpu | exceededMemory | scriptNotFound | canceled | unknown

      // Each log line in the event → a Loki value
      for (const log of event.logs ?? []) {
        const key = streamKey(app, outcome, log.level)
        const stream = ensureStream(streams, key, {
          app,
          env: env.WGR_ENV,
          cluster: env.WGR_CLUSTER,
          source: 'cf-worker',
          outcome,
          level: normaliseLevel(log.level),
        })
        const ts = `${(log.timestamp ?? event.eventTimestamp ?? Date.now()) * 1_000_000}`
        stream.values.push([ts, formatLogLine(event, log)])
      }

      // Surface exceptions as level=error lines even if no console.log was emitted
      for (const exc of event.exceptions ?? []) {
        const key = streamKey(app, outcome, 'error')
        const stream = ensureStream(streams, key, {
          app,
          env: env.WGR_ENV,
          cluster: env.WGR_CLUSTER,
          source: 'cf-worker',
          outcome,
          level: 'error',
        })
        const ts = `${(exc.timestamp ?? event.eventTimestamp ?? Date.now()) * 1_000_000}`
        stream.values.push([ts, formatExceptionLine(event, exc)])
      }

      // If outcome was non-ok but there were no logs/exceptions, emit a synthetic line
      // so the failure shows up in Grafana.
      if (outcome !== 'ok' && (event.logs?.length ?? 0) === 0 && (event.exceptions?.length ?? 0) === 0) {
        const key = streamKey(app, outcome, 'error')
        const stream = ensureStream(streams, key, {
          app,
          env: env.WGR_ENV,
          cluster: env.WGR_CLUSTER,
          source: 'cf-worker',
          outcome,
          level: 'error',
        })
        const ts = `${(event.eventTimestamp ?? Date.now()) * 1_000_000}`
        stream.values.push([ts, JSON.stringify({
          level: 'error',
          msg: `worker outcome: ${outcome}`,
          script: app,
          duration_cpu: event.cpuTime,
          duration_wall: event.wallTime,
        })])
      }
    }

    if (streams.size === 0) return

    const payload = { streams: Array.from(streams.values()) }
    const auth = btoa(`${env.WGR_INGEST_USER}:${env.WGR_INGEST_TOKEN}`)

    // Use ctx.waitUntil so the push completes even if tail() returns first.
    ctx.waitUntil(
      fetch(env.WGR_INGEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        if (!res.ok) {
          // Console.error → also captured by THIS worker's tail if it had one,
          // and visible via `wrangler tail wgr-tail-collector`
          const body = await res.text()
          console.error(`[wgr-tail-collector] push failed: ${res.status} ${body.slice(0, 200)}`)
        }
      }).catch((err: unknown) => {
        console.error(`[wgr-tail-collector] push error:`, err)
      })
    )
  },
}

function streamKey(app: string, outcome: string, level: string | undefined): string {
  return `${app}::${outcome}::${normaliseLevel(level)}`
}

function ensureStream(
  map: Map<string, LokiStream>,
  key: string,
  labels: Record<string, string>,
): LokiStream {
  let stream = map.get(key)
  if (!stream) {
    stream = { stream: labels, values: [] }
    map.set(key, stream)
  }
  return stream
}

function normaliseLevel(level: string | undefined): string {
  if (!level) return 'info'
  const l = level.toLowerCase()
  if (l === 'log') return 'info'
  if (l === 'warning') return 'warn'
  return l  // debug | info | warn | error | fatal
}

function formatLogLine(event: TraceItem, log: TraceLog): string {
  const msg = Array.isArray(log.message)
    ? log.message.map(stringify).join(' ')
    : stringify(log.message)
  return JSON.stringify({
    level: normaliseLevel(log.level),
    msg,
    script: event.scriptName,
    duration_cpu: event.cpuTime,
    duration_wall: event.wallTime,
  })
}

function formatExceptionLine(event: TraceItem, exc: TraceException): string {
  return JSON.stringify({
    level: 'error',
    msg: exc.message ?? exc.name ?? 'exception',
    name: exc.name,
    stack: (exc as TraceException & { stack?: string }).stack,
    script: event.scriptName,
    duration_cpu: event.cpuTime,
  })
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
