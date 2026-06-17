import { describe, expect, it } from 'vitest'
import { postProblem } from '../src/api/problems.js'

function recordingFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const cfg = { url: 'https://logs.example/mgmt', adminToken: 'ADMIN' }
const candidate = { signature: 's1', category: 'Notice', file: '/x.ctp', line: 13, sample: 'x', count: 4, fixabilityScore: 0.9 }

describe('postProblem', () => {
  it('PUTs/POSTs to the project problems route with Bearer admin auth', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{}', { status: 201 }))
    await postProblem(cfg, 'prometerre', candidate, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/projects/prometerre/problems')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer ADMIN')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ signature: 's1', count: 4, fixabilityScore: 0.9 })
  })

  it('throws on non-2xx', async () => {
    const { fetchImpl } = recordingFetch(new Response('nope', { status: 401 }))
    await expect(postProblem(cfg, 'p', candidate, fetchImpl)).rejects.toThrow()
  })
})
