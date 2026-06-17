import { describe, expect, it } from 'vitest'
import { groupCandidates, type LokiReader } from '../src/scan/scanner.js'

describe('groupCandidates', () => {
  it('groups identical errors by signature and counts them', () => {
    const lines = [
      '2026-06-17 10:00:00 Notice: Trying to get property \'slug\' of non-object in [/x/view.ctp, line 13]',
      '2026-06-17 10:01:00 Notice: Trying to get property \'slug\' of non-object in [/x/view.ctp, line 14]',
      '2026-06-17 10:02:00 Error: [App\\FooException] boom (/x/Foo.php:9)',
    ]
    const out = groupCandidates(lines)
    expect(out).toHaveLength(2)
    const notice = out.find((c) => c.category === 'Notice')!
    expect(notice.count).toBe(2)
    expect(notice.fixabilityScore).toBeGreaterThan(0)
    expect(notice.sample).toContain('Trying to get property')
  })

  it('orders candidates by fixability score descending', () => {
    const lines = [
      '2026-06-17 10:00:00 Error: SQLSTATE connection timed out',
      '2026-06-17 10:00:01 Notice: undefined in [/x.ctp, line 1]',
    ]
    const out = groupCandidates(lines)
    expect(out[0].category).toBe('Notice') // higher fixability first
  })

  it('redacts secrets in the stored sample', () => {
    const out = groupCandidates(['2026-06-17 10:00:00 Error: leaked AKIAIOSFODNN7EXAMPLE (/x.php:1)'])
    expect(out[0].sample).toContain('[REDACTED]')
    expect(out[0].sample).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})

describe('runScan (with injected reader)', () => {
  it('queries each project and returns candidates per project', async () => {
    const { runScan } = await import('../src/scan/scanner.js')
    const reader: LokiReader = async () => [
      '2026-06-17 10:00:00 Notice: x in [/a.ctp, line 1]',
      '2026-06-17 10:01:00 Notice: x in [/a.ctp, line 2]',
    ]
    const result = await runScan({
      projects: [{ name: 'prometerre', lokiSelector: '{host="h"}' }],
      reader,
      windowMs: 3_600_000,
      now: 1_700_000_000_000,
    })
    expect(result).toHaveLength(1)
    expect(result[0].project).toBe('prometerre')
    expect(result[0].candidates[0].count).toBe(2)
  })
})
