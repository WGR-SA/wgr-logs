import { describe, expect, it } from 'vitest'
import { selectNext } from '../src/auto/select.js'
import type { Problem, Remediation } from '../src/types.js'

const P = (id: number, score: number, count: number, signature: string): Problem => ({
  id, project: 'p', signature, patternHash: null, tech: null, category: 'Notice',
  file: '/x.ctp', line: 1, sample: 's', count, fixabilityScore: score, status: 'open',
})
const R = (problemId: number, status: string): Remediation => ({
  id: problemId * 10, problemId, repo: 'r', branch: null, prUrl: null, prNumber: null,
  sessionId: null, status: status as Remediation['status'], costUsd: 0, summary: null,
  diffStat: null, notVerified: null, pendingComment: null,
})

describe('selectNext', () => {
  it('picks the highest fixability among unhandled problems', () => {
    const got = selectNext([P(1, 0.5, 9, 'a'), P(2, 0.9, 3, 'b'), P(3, 0.7, 1, 'c')], [])
    expect(got?.id).toBe(2)
  })
  it('skips problems with an active or terminal remediation', () => {
    const got = selectNext([P(1, 0.9, 9, 'a'), P(2, 0.6, 3, 'b')], [R(1, 'pr_open')])
    expect(got?.id).toBe(2)
  })
  it('treats fixing/merged/wontfix/needs_input/changes_requested as handled', () => {
    for (const s of ['fixing', 'merged', 'wontfix', 'needs_input', 'changes_requested']) {
      expect(selectNext([P(1, 0.9, 9, 'a')], [R(1, s)])).toBeNull()
    }
  })
  it('re-selects a problem whose only remediation failed', () => {
    expect(selectNext([P(1, 0.9, 9, 'a')], [R(1, 'failed')])?.id).toBe(1)
  })
  it('returns null when nothing is selectable', () => {
    expect(selectNext([], [])).toBeNull()
  })
})
