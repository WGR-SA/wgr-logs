import { describe, expect, it, vi } from 'vitest'
import { ensureProjectContext, type EnsureContextDeps } from '../src/fix/context.js'

const base = (over: Partial<EnsureContextDeps>): EnsureContextDeps => ({
  repo: 'github.com/wgr-sa/p',
  tech: 'cakephp',
  dir: '/tmp/clone',
  getCtx: async () => null,
  putCtx: async (_repo, body) => ({ id: 1, repo: 'github.com/wgr-sa/p', tech: 'cakephp', summary: body.summary }),
  generate: async () => 'GENERATED',
  readClaudeMd: () => null,
  writeClaudeMd: vi.fn(),
  ...over,
})

describe('ensureProjectContext', () => {
  it('reuses the cached API summary and does not generate', async () => {
    const generate = vi.fn(async () => 'GENERATED')
    const out = await ensureProjectContext(base({ getCtx: async () => ({ id: 1, repo: 'r', tech: 't', summary: 'CACHED' }), generate }))
    expect(out).toBe('CACHED')
    expect(generate).not.toHaveBeenCalled()
  })

  it('reuses an existing CLAUDE.md in the clone', async () => {
    const generate = vi.fn(async () => 'GENERATED')
    const out = await ensureProjectContext(base({ readClaudeMd: () => 'REPO_CLAUDE', generate }))
    expect(out).toBe('REPO_CLAUDE')
    expect(generate).not.toHaveBeenCalled()
  })

  it('generates, persists and writes CLAUDE.md when nothing is cached', async () => {
    const writeClaudeMd = vi.fn()
    const putCtx = vi.fn(async (_r: string, b: { summary: string }) => ({ id: 1, repo: 'r', tech: null, summary: b.summary }))
    const out = await ensureProjectContext(base({ writeClaudeMd, putCtx }))
    expect(out).toBe('GENERATED')
    expect(writeClaudeMd).toHaveBeenCalledWith('GENERATED')
    expect(putCtx).toHaveBeenCalled()
  })
})
