import { describe, expect, it } from 'vitest'
import { adminApiCall, lokiQueryRange } from '../src/tools/http.js'
import { HttpError } from '../src/lib/errors.js'
import type { AdminApiConfig, IngestConfig } from '../src/config/env.js'

const adminConfig: AdminApiConfig = {
  url: 'https://logs.example.com',
  adminToken: 'ADMIN-TOKEN',
  registerToken: 'REG-TOKEN',
}

interface Captured {
  url: string
  init: RequestInit | undefined
}

function recordingFetch(response: () => Response): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = []
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(response())
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization
}

describe('adminApiCall', () => {
  it('injects the register token into the body and sends no Authorization header', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(JSON.stringify({ agent_id: 'a1', agent_token: 't', status: 'pending' }), { status: 201 }))
    const result = await adminApiCall(adminConfig, { method: 'POST', path: '/mgmt/agents/register', body: { name: 'x' } }, fetch)

    expect(authHeader(calls[0].init)).toBeUndefined()
    const sentBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(sentBody.register_token).toBe('REG-TOKEN')
    expect(sentBody.name).toBe('x')
    expect(result).toMatchObject({ agent_id: 'a1' })
  })

  it('sends Bearer admin auth on guarded routes', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(JSON.stringify([]), { status: 200 }))
    await adminApiCall(adminConfig, { method: 'GET', path: '/mgmt/agents' }, fetch)
    expect(authHeader(calls[0].init)).toBe('Bearer ADMIN-TOKEN')
  })

  it('refuses a non-whitelisted call before hitting the network', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('', { status: 200 }))
    await expect(adminApiCall(adminConfig, { method: 'GET', path: '/mgmt/secrets' }, fetch)).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(0)
  })

  it('throws HttpError with status on a non-2xx response', async () => {
    const { fetch } = recordingFetch(() => new Response('nope', { status: 401 }))
    await expect(adminApiCall(adminConfig, { method: 'GET', path: '/mgmt/agents' }, fetch)).rejects.toMatchObject({ status: 401 })
  })
})

describe('lokiQueryRange', () => {
  it('queries Loki with basic auth via the injected fetch', async () => {
    const ingest: IngestConfig = { url: 'https://ingest.example.com', token: 'INGEST' }
    const body = { status: 'success', data: { resultType: 'matrix', result: [] } }
    const { fetch, calls } = recordingFetch(() => new Response(JSON.stringify(body), { status: 200 }))
    const res = await lokiQueryRange(ingest, { query: 'count_over_time({host="m"}[5m])' }, fetch)

    expect(calls[0].url).toContain('/loki/api/v1/query_range')
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization
    expect(auth.startsWith('Basic ')).toBe(true)
    expect(res.status).toBe('success')
  })
})
