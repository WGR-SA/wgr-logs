export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LokiStream {
  stream: Record<string, string>
  values: Array<[timestampNs: string, line: string]>
}

export interface LokiPushPayload {
  streams: LokiStream[]
}

export type LokiResultType = 'streams' | 'matrix' | 'vector'

export interface LokiQueryRangeResponse {
  status: 'success' | 'error'
  data: {
    resultType: LokiResultType
    result: Array<{
      stream?: Record<string, string>
      metric?: Record<string, string>
      values?: Array<[timestampNs: string, line: string]>
      value?: [timestampSec: number, scalar: string]
    }>
    stats?: Record<string, unknown>
  }
}

export interface QueryRangeOptions {
  query: string
  start?: Date | number | string
  end?: Date | number | string
  limit?: number
  direction?: 'forward' | 'backward'
  step?: string
}

export interface LokiClientOptions {
  baseUrl: string
  token?: string
  basicAuth?: { username: string; password: string }
  fetch?: typeof fetch
  defaultLimit?: number
}

export type AlertState = 'normal' | 'pending' | 'firing' | 'no_data' | 'error'

export interface AlertInstance {
  fingerprint: string
  state: AlertState
  labels: Record<string, string>
  annotations: Record<string, string>
  activeAt?: string
  value?: string
}
