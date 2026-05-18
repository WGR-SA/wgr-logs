/**
 * @wgr/logs-browser — tiny browser logger for wgr-logs.
 *
 * Captures uncaught errors and lets you push custom log lines from a browser
 * app to a Cloudflare Worker (wgr-browser-collector) which forwards to Loki.
 *
 * Usage:
 *   import { initLogger } from '@wgr/logs-browser'
 *
 *   const logger = initLogger({
 *     collector: 'https://collector.example.com',
 *     app: 'my-site',
 *     env: 'prod',
 *     release: 'v1.2.3',
 *   })
 *
 *   logger.error('manual error', { extra: 'context' })
 *   logger.setUser('anon-xxx')
 *
 * Zero deps. ~3 KB minified. Designed to never break the host page.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  /** URL of the collector Worker, e.g. `https://collector.example.com` */
  collector: string
  /** App label, must match the collector's ALLOWED_APPS */
  app: string
  /** Env label (`prod`, `staging`, `dev`) */
  env?: string
  /** App version/release, included in every line */
  release?: string
  /** Pre-set user id (use `setUser()` later to update) */
  user?: string
  /** Hook `window.onerror` + `unhandledrejection` (default: true) */
  autoHook?: boolean
  /** Also forward `console.error` (default: false — can be noisy) */
  hookConsoleError?: boolean
  /** Batch flush interval in ms (default: 2000) */
  flushIntervalMs?: number
  /** Max batch size before forced flush (default: 50) */
  maxBatchSize?: number
  /** Don't actually push (for tests / dev) */
  dryRun?: boolean
}

export interface LogContext {
  [key: string]: unknown
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void
  info(msg: string, ctx?: LogContext): void
  warn(msg: string, ctx?: LogContext): void
  error(msg: string, ctx?: LogContext): void
  setUser(userId: string | null): void
  /** Force flush the in-memory buffer immediately */
  flush(): Promise<void>
  /** Stop hooks + flush remaining */
  destroy(): Promise<void>
}

interface BufferedLog {
  level: LogLevel
  msg: string
  stack?: string
  ts: number
  ctx?: LogContext
}

const DEFAULT_FLUSH_MS = 2000
const DEFAULT_MAX_BATCH = 50

export function initLogger(opts: LoggerOptions): Logger {
  const collector = opts.collector.replace(/\/$/, '')
  const flushUrl = `${collector}/push`
  const flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_MS
  const maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH
  let userId: string | null = opts.user ?? null

  const buffer: BufferedLog[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let pageHideHandler: ((e: Event) => void) | null = null
  let errorHandler: ((e: ErrorEvent) => void) | null = null
  let rejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null
  let originalConsoleError: typeof console.error | null = null
  let destroyed = false

  function enqueue(level: LogLevel, msg: string, ctx?: LogContext, stack?: string) {
    if (destroyed) return
    buffer.push({ level, msg, stack, ts: Date.now(), ctx })
    if (buffer.length >= maxBatchSize) {
      void flush()
    }
  }

  async function flush(useBeacon = false): Promise<void> {
    if (buffer.length === 0) return
    const batch = buffer.splice(0, buffer.length)

    const payload = {
      app: opts.app,
      env: opts.env ?? 'prod',
      logs: batch.map((b) => ({
        level: b.level,
        msg: b.msg,
        stack: b.stack,
        ts: b.ts,
        url: typeof location !== 'undefined' ? location.href : undefined,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        release: opts.release,
        user_id: userId ?? undefined,
        ctx: b.ctx,
      })),
    }

    if (opts.dryRun) return

    const body = JSON.stringify(payload)
    try {
      if (useBeacon && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon(flushUrl, blob)
        return
      }
      await fetch(flushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // keepalive lets the request survive a page unload up to ~64 KB
        keepalive: body.length < 60_000,
      })
    } catch {
      // Network error → drop the batch silently. We never want the logger
      // to throw and break the host page.
    }
  }

  // Auto-hook handlers
  if (opts.autoHook !== false && typeof window !== 'undefined') {
    errorHandler = (e: ErrorEvent) => {
      enqueue('error', e.message || 'error', {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      }, e.error?.stack)
    }
    rejectionHandler = (e: PromiseRejectionEvent) => {
      const reason: unknown = e.reason
      const msg = reason instanceof Error ? reason.message : safeStringify(reason)
      const stack = reason instanceof Error ? reason.stack : undefined
      enqueue('error', `unhandledrejection: ${msg}`, undefined, stack)
    }
    window.addEventListener('error', errorHandler)
    window.addEventListener('unhandledrejection', rejectionHandler)
  }

  if (opts.hookConsoleError && typeof console !== 'undefined') {
    originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      const msg = args.map(safeStringify).join(' ')
      enqueue('error', msg)
      originalConsoleError?.apply(console, args)
    }
  }

  // Periodic flush
  if (typeof window !== 'undefined') {
    timer = setInterval(() => { void flush() }, flushIntervalMs)

    // Flush on page unload (best-effort via sendBeacon)
    pageHideHandler = () => { void flush(true) }
    window.addEventListener('pagehide', pageHideHandler)
    window.addEventListener('beforeunload', pageHideHandler)
  }

  return {
    debug: (msg, ctx) => enqueue('debug', msg, ctx),
    info:  (msg, ctx) => enqueue('info',  msg, ctx),
    warn:  (msg, ctx) => enqueue('warn',  msg, ctx),
    error: (msg, ctx) => enqueue('error', msg, ctx),
    setUser(id) { userId = id },
    flush: () => flush(false),
    async destroy() {
      if (destroyed) return
      destroyed = true
      if (timer) clearInterval(timer)
      if (typeof window !== 'undefined') {
        if (pageHideHandler) {
          window.removeEventListener('pagehide', pageHideHandler)
          window.removeEventListener('beforeunload', pageHideHandler)
        }
        if (errorHandler) window.removeEventListener('error', errorHandler)
        if (rejectionHandler) window.removeEventListener('unhandledrejection', rejectionHandler)
      }
      if (originalConsoleError) {
        console.error = originalConsoleError
      }
      await flush()
    },
  }
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
