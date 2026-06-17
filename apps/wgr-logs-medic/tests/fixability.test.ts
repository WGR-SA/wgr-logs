import { describe, expect, it } from 'vitest'
import { scoreFixability } from '../src/scan/fixability.js'
import type { ParsedError } from '../src/types.js'

const base: ParsedError = { signature: 's', category: 'Error', template: 't' }

describe('scoreFixability', () => {
  it('rates a localized Notice (file:line known) as highly fixable', () => {
    const r = scoreFixability({ ...base, category: 'Notice', file: '/x/view.ctp', line: 13 })
    expect(r.score).toBeGreaterThanOrEqual(0.8)
  })

  it('rates an infra-flavoured error (no file) as low fixability', () => {
    const r = scoreFixability({ ...base, category: 'Error', template: 'SQLSTATE connection timed out' })
    expect(r.score).toBeLessThan(0.4)
  })

  it('boosts when a file:line is present vs absent', () => {
    const withLoc = scoreFixability({ ...base, file: '/x.php', line: 9 }).score
    const without = scoreFixability({ ...base }).score
    expect(withLoc).toBeGreaterThan(without)
  })

  it('always returns a score in [0,1] and a non-empty reason', () => {
    const r = scoreFixability(base)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
    expect(r.reason.length).toBeGreaterThan(0)
  })
})
