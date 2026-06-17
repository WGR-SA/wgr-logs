/** Typed errors so the CLI can render actionable messages and exit codes. */

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/** A required env var / config value is missing or malformed. */
export class ConfigError extends AgentError {
  constructor(message: string) {
    super(message, 'CONFIG')
    this.name = 'ConfigError'
  }
}

/** An SSH operation failed (connection, auth, non-zero exit when fatal). */
export class SshError extends AgentError {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message, 'SSH')
    this.name = 'SshError'
  }
}

/** An HTTP call (admin API / Loki) returned a non-2xx or was rejected by the whitelist. */
export class HttpError extends AgentError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message, 'HTTP')
    this.name = 'HttpError'
  }
}
