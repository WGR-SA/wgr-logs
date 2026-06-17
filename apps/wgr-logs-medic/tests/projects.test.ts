import { describe, expect, it } from 'vitest'
import { ProjectSchema, parseProjects, loadProjects } from '../src/config/projects.js'
import { ConfigError } from '../src/config/env.js'

describe('ProjectSchema', () => {
  it('parses a project with a loki selector', () => {
    const p = ProjectSchema.parse({ name: 'prometerre', lokiSelector: '{host="ov-eda3ed", source="cakephp"}' })
    expect(p.name).toBe('prometerre')
  })

  it('rejects a project missing a selector', () => {
    expect(ProjectSchema.safeParse({ name: 'x' }).success).toBe(false)
  })
})

describe('parseProjects', () => {
  it('parses a YAML document into a list', () => {
    const yaml = 'projects:\n  - name: prometerre\n    lokiSelector: \'{host="ov-eda3ed", source="cakephp"}\'\n'
    expect(parseProjects(yaml)).toHaveLength(1)
  })
})

describe('loadProjects', () => {
  it('throws ConfigError when the projects file does not exist', () => {
    expect(() => loadProjects('/nonexistent/definitely/missing.yml')).toThrow(ConfigError)
  })
})
