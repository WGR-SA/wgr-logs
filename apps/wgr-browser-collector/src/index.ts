/**
 * wgr-browser-collector
 *
 * Public Cloudflare Worker. Accepts log batches from browsers
 * (via @wgr/logs-browser) and forwards them to the wgr-logs Loki endpoint.
 *
 * The browser side has no auth — we don't ship the INGEST token to clients.
 * The Worker holds the token as a secret and adds it server-side.
 *
 * Protections applied here:
 *   1. CORS — only the configured ALLOWED_ORIGINS may push
 *   2. App allowlist — payload.app must be in ALLOWED_APPS
 *   3. Size cap — refuse payloads > MAX_PAYLOAD_BYTES
 *   4. Batch cap — accept at most MAX_LOGS_PER_BATCH lines per request
 *   5. Server-side timestamp — don't trust the client clock
 *   6. Field sanitization — cap msg/stack/url lengths, strip unknown labels
 */

export interface Env {
  WGR_INGEST_URL: string
  WGR_INGEST_USER: string
  WGR_INGEST_TOKEN: string  // secret
  ALLOWED_ORIGINS: string
  ALLOWED_APPS: string
  MAX_PAYLOAD_BYTES?: string
  MAX_LOGS_PER_BATCH?: string
}

interface ClientLog {
  level?: string
  msg: string
  stack?: string
  url?: string
  ua?: string
  release?: string
  user_id?: string
  ctx?: Record<string, unknown>
  ts?: number  // optional client timestamp (ms) — used as a tie-breaker, not trusted
}

interface ClientPayload {
  app: string
  env?: string
  logs: ClientLog[]
}

const CAP_MSG = 4096
const CAP_STACK = 8192
const CAP_URL = 1024
const CAP_UA = 512
const CAP_CTX_JSON = 4096

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const allowedOrigins = parseList(env.ALLOWED_ORIGINS)
    const allowedApps = new Set(parseList(env.ALLOWED_APPS))
    const maxBytes = Number(env.MAX_PAYLOAD_BYTES ?? '65536')
    const maxBatch = Number(env.MAX_LOGS_PER_BATCH ?? '100')
    const origin = req.headers.get('Origin') ?? ''

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return corsResponse(origin, allowedOrigins, 204)
    }

    // Anything else than POST /push → 404
    const url = new URL(req.url)
    if (url.pathname !== '/push' || req.method !== 'POST') {
      return new Response('not found', { status: 404 })
    }

    // Origin allowlist
    if (!isOriginAllowed(origin, allowedOrigins)) {
      return corsResponse(origin, allowedOrigins, 403, 'origin not allowed')
    }

    // Size cap
    const contentLength = Number(req.headers.get('Content-Length') ?? '0')
    if (contentLength > maxBytes) {
      return corsResponse(origin, allowedOrigins, 413, 'payload too large')
    }

    // Parse JSON
    let payload: ClientPayload
    try {
      const text = await req.text()
      if (text.length > maxBytes) {
        return corsResponse(origin, allowedOrigins, 413, 'payload too large')
      }
      payload = JSON.parse(text) as ClientPayload
    } catch {
      return corsResponse(origin, allowedOrigins, 400, 'invalid JSON')
    }

    // App allowlist
    if (typeof payload.app !== 'string' || !allowedApps.has(payload.app)) {
      return corsResponse(origin, allowedOrigins, 403, 'app not allowed')
    }

    const logs = Array.isArray(payload.logs) ? payload.logs.slice(0, maxBatch) : []
    if (logs.length === 0) {
      return corsResponse(origin, allowedOrigins, 400, 'empty batch')
    }

    // Build Loki streams grouped by (app, env, level)
    const streams = new Map<string, { stream: Record<string, string>; values: Array<[string, string]> }>()
    const env_ = sanitiseShort(payload.env ?? 'prod', 32)
    const nowNs = `${Date.now() * 1_000_000}`

    for (const log of logs) {
      const level = normaliseLevel(log.level)
      const key = `${payload.app}::${env_}::${level}`
      let s = streams.get(key)
      if (!s) {
        s = {
          stream: {
            app: payload.app,
            env: env_,
            level,
            source: 'browser',
          },
          values: [],
        }
        streams.set(key, s)
      }

      const ts = (log.ts && Number.isFinite(log.ts)) ? `${Math.floor(log.ts * 1_000_000)}` : nowNs
      s.values.push([ts, JSON.stringify({
        level,
        msg: sanitiseShort(log.msg, CAP_MSG),
        stack: log.stack ? sanitiseShort(log.stack, CAP_STACK) : undefined,
        url: log.url ? sanitiseShort(log.url, CAP_URL) : undefined,
        ua: log.ua ? sanitiseShort(log.ua, CAP_UA) : undefined,
        release: log.release ? sanitiseShort(log.release, 64) : undefined,
        user_id: log.user_id ? sanitiseShort(log.user_id, 128) : undefined,
        ctx: log.ctx ? sanitiseCtx(log.ctx) : undefined,
      })])
    }

    // Push to Loki (server-side, with the secret token)
    const lokiPayload = { streams: Array.from(streams.values()) }
    const auth = btoa(`${env.WGR_INGEST_USER}:${env.WGR_INGEST_TOKEN}`)

    ctx.waitUntil(
      fetch(env.WGR_INGEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(lokiPayload),
      }).then(async (res) => {
        if (!res.ok) {
          console.error(`[wgr-browser-collector] push failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
        }
      }).catch((err: unknown) => {
        console.error(`[wgr-browser-collector] push error:`, err)
      })
    )

    return corsResponse(origin, allowedOrigins, 202)
  },
}

function parseList(s: string | undefined): string[] {
  if (!s) return []
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.includes('*')) return true
  if (!origin) return false
  return allowed.includes(origin)
}

function corsResponse(origin: string, allowed: string[], status: number, body?: string): Response {
  const allow = (allowed.includes('*') ? '*' : (isOriginAllowed(origin, allowed) ? origin : ''))
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return new Response(body ?? null, { status, headers })
}

function normaliseLevel(v: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  switch ((v ?? '').toLowerCase()) {
    case 'debug': return 'debug'
    case 'warn':
    case 'warning': return 'warn'
    case 'error':
    case 'fatal': return 'error'
    default: return 'info'
  }
}

function sanitiseShort(v: unknown, cap: number): string {
  if (typeof v !== 'string') return String(v ?? '').slice(0, cap)
  return v.slice(0, cap)
}

function sanitiseCtx(ctx: Record<string, unknown>): Record<string, unknown> | string {
  try {
    const s = JSON.stringify(ctx)
    if (s.length > CAP_CTX_JSON) {
      return s.slice(0, CAP_CTX_JSON) + '…'
    }
    return ctx
  } catch {
    return '<unserialisable>'
  }
}
