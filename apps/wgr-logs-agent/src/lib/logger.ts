/**
 * Minimal structured logger. Pretty in a TTY, line-delimited JSON otherwise.
 * Registered secrets are redacted from every message — secrets must never hit
 * stdout/stderr or a log file.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  /** Register secret values to redact from all subsequent output. */
  redact(...secrets: Array<string | undefined>): void
}

export interface LoggerOptions {
  json?: boolean
  level?: LogLevel
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function createLogger(options: LoggerOptions = {}): Logger {
  const json = options.json ?? !process.stdout.isTTY
  const minLevel = LEVEL_ORDER[options.level ?? 'info']
  const secrets = new Set<string>()

  const scrub = (value: string): string => {
    let out = value
    for (const secret of secrets) out = out.split(secret).join('***')
    return out
  }

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) return
    const safeMessage = scrub(message)
    const safeFields = fields ? JSON.parse(scrub(JSON.stringify(fields))) : undefined
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
    if (json) {
      stream.write(`${JSON.stringify({ level, message: safeMessage, ...safeFields })}\n`)
    } else {
      const tag = { debug: 'dbg', info: 'inf', warn: 'WARN', error: 'ERR' }[level]
      const suffix = safeFields ? ` ${JSON.stringify(safeFields)}` : ''
      stream.write(`[${tag}] ${safeMessage}${suffix}\n`)
    }
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    redact: (...values) => {
      for (const v of values) if (v) secrets.add(v)
    },
  }
}
