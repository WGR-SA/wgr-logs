import { describe, expect, it } from 'vitest'
import { ProjectSchema, fixEligible } from '../src/config/projects.js'

const full = {
  name: 'prometerre',
  lokiSelector: '{host="ov-eda3ed", source="cakephp"}',
  tech: 'cakephp',
  repo: 'github.com/wgr-sa/prometerre',
  defaultBranch: 'main',
  pathPrefix: '/data01/sites/prometerre/prod/prometerre.ch',
}

describe('ProjectSchema (fix fields)', () => {
  it('parses the optional fix fields', () => {
    const p = ProjectSchema.parse(full)
    expect(p.tech).toBe('cakephp')
    expect(p.repo).toBe('github.com/wgr-sa/prometerre')
    expect(p.pathPrefix).toBe('/data01/sites/prometerre/prod/prometerre.ch')
  })

  it('still parses a triage-only project (no fix fields)', () => {
    const p = ProjectSchema.parse({ name: 'x', lokiSelector: '{a="b"}' })
    expect(p.repo).toBeUndefined()
  })
})

describe('fixEligible', () => {
  it('is true only when a repo is configured', () => {
    expect(fixEligible(ProjectSchema.parse(full))).toBe(true)
    expect(fixEligible(ProjectSchema.parse({ name: 'x', lokiSelector: '{a="b"}' }))).toBe(false)
  })
})
