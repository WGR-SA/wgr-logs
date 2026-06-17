import { LokiClient } from '@wgr/logs-client'
import type { LokiQueryRangeResponse, QueryRangeOptions } from '@wgr/logs-client'
import type { AdminApiConfig, IngestConfig } from '../config/env.js'
import { HttpError } from '../lib/errors.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type Gate = 'auto' | 'confirm' | 'strong'
export type AuthMode = 'admin' | 'register-body'

interface AdminRoute {
  method: HttpMethod
  pattern: RegExp
  gate: Gate
  auth: AuthMode
}

/** Whitelist of admin-API routes the agent may call (path only, no query string). */
const ADMIN_ROUTES: readonly AdminRoute[] = [
  { method: 'POST', pattern: /^\/mgmt\/agents\/register$/, gate: 'confirm', auth: 'register-body' },
  { method: 'GET', pattern: /^\/mgmt\/agents$/, gate: 'auto', auth: 'admin' },
  { method: 'GET', pattern: /^\/mgmt\/agents\/[^/]+$/, gate: 'auto', auth: 'admin' },
  { method: 'PUT', pattern: /^\/mgmt\/agents\/[^/]+$/, gate: 'confirm', auth: 'admin' },
  { method: 'DELETE', pattern: /^\/mgmt\/agents\/[^/]+$/, gate: 'strong', auth: 'admin' },
  { method: 'GET', pattern: /^\/mgmt\/agents\/[^/]+\/sources$/, gate: 'auto', auth: 'admin' },
  { method: 'POST', pattern: /^\/mgmt\/agents\/[^/]+\/sources$/, gate: 'confirm', auth: 'admin' },
  { method: 'PUT', pattern: /^\/mgmt\/agents\/[^/]+\/sources\/[^/]+$/, gate: 'confirm', auth: 'admin' },
  { method: 'DELETE', pattern: /^\/mgmt\/agents\/[^/]+\/sources\/[^/]+$/, gate: 'strong', auth: 'admin' },
  { method: 'GET', pattern: /^\/mgmt\/source-types$/, gate: 'auto', auth: 'admin' },
]

export interface AdminClassification {
  gate: Gate
  auth: AuthMode
}

/** Returns the matched route's gate+auth, or null if the call is not whitelisted. */
export function classifyAdminCall(method: string, path: string): AdminClassification | null {
  const cleanPath = path.split('?')[0]
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern.test(cleanPath))
  return route ? { gate: route.gate, auth: route.auth } : null
}

export interface AdminCall {
  method: HttpMethod
  path: string
  body?: Record<string, unknown>
}

export async function adminApiCall(
  config: AdminApiConfig,
  call: AdminCall,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const cls = classifyAdminCall(call.method, call.path)
  if (!cls) {
    throw new HttpError(`Refused: ${call.method} ${call.path} is not in the admin-API whitelist.`, 403)
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body = call.body
  if (cls.auth === 'admin') {
    headers.Authorization = `Bearer ${config.adminToken}`
  } else {
    // register: token goes in the body, injected here so the model never sees it.
    if (!config.registerToken) throw new HttpError('WGR_API_REGISTER_TOKEN is required to register an agent.', 400)
    body = { ...(call.body ?? {}), register_token: config.registerToken }
  }

  const res = await fetchImpl(`${config.url}${call.path}`, {
    method: call.method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new HttpError(`${call.method} ${call.path} → ${res.status}: ${text}`, res.status)
  return text ? (JSON.parse(text) as unknown) : null
}

export async function lokiQueryRange(
  ingest: IngestConfig,
  options: QueryRangeOptions,
  fetchImpl?: typeof fetch,
): Promise<LokiQueryRangeResponse> {
  const client = new LokiClient({
    baseUrl: ingest.url,
    basicAuth: { username: 'wgr', password: ingest.token },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  return client.queryRange(options)
}
