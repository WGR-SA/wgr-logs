import { describe, expect, it } from 'vitest'
import {
  sbxSetDefaultDenyArgs,
  sbxCreateArgs,
  sbxPolicyAllowArgs,
  sbxExecClaudeArgs,
  sbxRmArgs,
} from '../src/fix/sbx.js'

describe('sbx arg builders', () => {
  it('sets the default deny-all egress policy (idempotent baseline)', () => {
    expect(sbxSetDefaultDenyArgs()).toEqual(['policy', 'set-default', 'deny-all'])
  })
  it('creates a named claude sandbox with explicit --cpus over a workspace dir', () => {
    expect(sbxCreateArgs('med-1', '/tmp/c', 2)).toEqual(['create', '--name', 'med-1', '--cpus', '2', 'claude', '/tmp/c'])
  })
  it('allows network with --sandbox AFTER network subcommand', () => {
    expect(sbxPolicyAllowArgs('med-1', 'api.anthropic.com')).toEqual(['policy', 'allow', 'network', '--sandbox', 'med-1', 'api.anthropic.com'])
  })
  it('execs claude headless with -p inside the named sandbox', () => {
    expect(sbxExecClaudeArgs('med-1', 'PROMPT')).toEqual(['exec', 'med-1', 'claude', '-p', 'PROMPT'])
  })
  it('removes the sandbox with --force', () => {
    expect(sbxRmArgs('med-1')).toEqual(['rm', '--force', 'med-1'])
  })
})
