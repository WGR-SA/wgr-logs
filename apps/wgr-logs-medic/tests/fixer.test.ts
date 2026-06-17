import { describe, expect, it } from 'vitest'
import { buildFixPrompt, parseFixResult } from '../src/fix/fixer.js'

describe('buildFixPrompt', () => {
  it('includes the repo path, category and redacted sample, and forbids pushing', () => {
    const p = buildFixPrompt({
      repoPath: 'src/Template/Topics/view.ctp',
      category: 'Notice',
      sample: "Trying to get property 'slug' of non-object",
      context: 'CakePHP app',
    })
    expect(p).toContain('src/Template/Topics/view.ctp')
    expect(p).toContain('Notice')
    expect(p).toContain("Trying to get property 'slug'")
    expect(p.toLowerCase()).toContain('do not push')
    expect(p).toContain('```json')
  })
})

describe('parseFixResult', () => {
  it('extracts the trailing json block', () => {
    const raw =
      'I fixed it.\n```json\n{"prTitle":"Fix null guard","prBody":"body","summary":"added guard","changedFiles":["src/x.ctp"]}\n```\n'
    const r = parseFixResult(raw)
    expect(r.prTitle).toBe('Fix null guard')
    expect(r.changedFiles).toEqual(['src/x.ctp'])
  })

  it('throws when no json block is present', () => {
    expect(() => parseFixResult('no json here')).toThrow()
  })
})
