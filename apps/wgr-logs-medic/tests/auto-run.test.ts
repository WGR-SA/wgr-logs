import { describe, expect, it, vi } from 'vitest'
import { runAuto, type AutoDeps } from '../src/auto/run.js'
import type { Problem, Remediation } from '../src/types.js'

const target = { name: 'p', lokiSelector: '{a="b"}', repo: 'o/r' }
const P = (id: number, score: number): Problem => ({
  id, project: 'p', signature: 's' + id, patternHash: null, tech: null, category: 'Notice',
  file: '/x.ctp', line: 1, sample: 's', count: 1, fixabilityScore: score, status: 'open',
})
const R = (id: number, problemId: number, status: string): Remediation => ({
  id, problemId, repo: 'o/r', branch: 'b', prUrl: 'u', prNumber: 1, sessionId: null,
  status: status as Remediation['status'], costUsd: 0, summary: null, diffStat: null, notVerified: null, pendingComment: 'please rename',
})

function deps(over: Partial<AutoDeps>): AutoDeps {
  return {
    targets: [target],
    scan: vi.fn(async () => {}),
    listProblems: vi.fn(async () => [P(1, 0.9), P(2, 0.5)]),
    listRemediations: vi.fn(async () => []),
    fix: vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 })),
    resume: vi.fn(async () => ({ prUrl: 'pr' })),
    max: 1,
    ...over,
  }
}

describe('runAuto', () => {
  it('processes a pending resume before any new fix', async () => {
    const resume = vi.fn(async () => ({ prUrl: 'pr' }))
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const d = deps({ listRemediations: vi.fn(async () => [R(70, 1, 'changes_requested')]), resume, fix })
    const out = await runAuto(d)
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ remediationId: 70 }))
    expect(out.resumed).toBe(1)
  })
  it('fixes the easiest unhandled problem when no resumes pending', async () => {
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const out = await runAuto(deps({ fix }))
    expect(fix).toHaveBeenCalledWith(expect.objectContaining({ problem: expect.objectContaining({ id: 1 }) }))
    expect(out.fixed).toBe(1)
  })
  it('does nothing when all problems are handled', async () => {
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const out = await runAuto(deps({ listRemediations: vi.fn(async () => [R(10, 1, 'pr_open'), R(20, 2, 'merged')]), fix }))
    expect(fix).not.toHaveBeenCalled()
    expect(out.fixed).toBe(0)
  })
})
