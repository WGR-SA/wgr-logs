import { describe, expect, it } from 'vitest'
import { createRemediation, updateRemediation } from '../src/api/remediations.js'
import { getProjectContext, putProjectContext } from '../src/api/context.js'

function recordingFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const cfg = { url: 'https://logs.example/mgmt', adminToken: 'ADMIN' }

describe('remediations client', () => {
  it('POSTs a remediation with Bearer auth to the project route', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":7}', { status: 201 }))
    const r = await createRemediation(cfg, 'prometerre', { problemId: 3, repo: 'github.com/wgr-sa/p' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/projects/prometerre/remediations')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer ADMIN')
    expect(r.id).toBe(7)
  })

  it('PATCHes a remediation by id', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":7}', { status: 200 }))
    await updateRemediation(cfg, 7, { status: 'pr_open' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/remediations/7')
    expect(calls[0].init?.method).toBe('PATCH')
  })

  it('throws on non-2xx', async () => {
    const { fetchImpl } = recordingFetch(new Response('no', { status: 401 }))
    await expect(createRemediation(cfg, 'p', { problemId: 1, repo: 'r' }, fetchImpl)).rejects.toThrow()
  })
})

describe('project-context client', () => {
  it('GET returns null on 404', async () => {
    const { fetchImpl } = recordingFetch(new Response('', { status: 404 }))
    expect(await getProjectContext(cfg, 'github.com/wgr-sa/p', fetchImpl)).toBeNull()
  })

  it('PUT url-encodes the repo', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":1,"repo":"github.com/wgr-sa/p","tech":null,"summary":"s"}', { status: 200 }))
    await putProjectContext(cfg, 'github.com/wgr-sa/p', { summary: 's' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/project-context/github.com%2Fwgr-sa%2Fp')
    expect(calls[0].init?.method).toBe('PUT')
  })
})
