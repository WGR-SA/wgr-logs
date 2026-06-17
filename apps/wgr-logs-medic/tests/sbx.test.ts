import { describe, expect, it } from 'vitest'
import { sbxCreateArgs, sbxPolicyAllowArgs, sbxRunClaudeArgs, sbxRmArgs } from '../src/fix/sbx.js'

describe('sbx arg builders', () => {
  it('creates a named claude sandbox over a workspace dir', () => {
    expect(sbxCreateArgs('med-123', '/tmp/clone')).toEqual(['create', '--name', 'med-123', 'claude', '/tmp/clone'])
  })
  it('allows only the anthropic domain, scoped to the sandbox', () => {
    expect(sbxPolicyAllowArgs('med-123', 'api.anthropic.com')).toEqual(['policy', 'allow', '--sandbox', 'med-123', 'network', 'api.anthropic.com'])
  })
  it('runs claude headless with the prompt after the -- separator', () => {
    expect(sbxRunClaudeArgs('med-123', 'FIXPROMPT')).toEqual(['run', '--name', 'med-123', '--', '-p', 'FIXPROMPT'])
  })
  it('removes the sandbox', () => {
    expect(sbxRmArgs('med-123')).toEqual(['rm', '--force', 'med-123'])
  })
})
