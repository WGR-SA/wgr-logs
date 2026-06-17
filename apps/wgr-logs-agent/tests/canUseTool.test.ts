import { describe, expect, it, vi } from 'vitest'
import { makeCanUseTool, type ConfirmFn } from '../src/safety/canUseTool.js'
import type { Logger } from '../src/lib/logger.js'

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  redact: () => {},
}

const callOpts = { signal: new AbortController().signal, toolUseID: 't1' }

function make(overrides: { dryRun?: boolean; autoApprove?: boolean; confirm?: ConfirmFn } = {}) {
  const confirm = overrides.confirm ?? vi.fn<ConfirmFn>(async () => true)
  const canUse = makeCanUseTool({
    dryRun: overrides.dryRun ?? false,
    autoApprove: overrides.autoApprove ?? false,
    confirm,
    logger: noopLogger,
    targetLabel: 'mutu (h2web287)',
  })
  return { canUse, confirm }
}

describe('makeCanUseTool', () => {
  it('denies any non-wgr tool (built-in backstop)', async () => {
    const { canUse } = make()
    const r = await canUse('Bash', { command: 'rm -rf /' }, callOpts)
    expect(r.behavior).toBe('deny')
  })

  it('auto-allows read-only tools', async () => {
    const { canUse } = make()
    expect((await canUse('mcp__wgr__ssh_get', { remotePath: '/x' }, callOpts)).behavior).toBe('allow')
    expect((await canUse('mcp__wgr__http_loki_query', { query: '{}' }, callOpts)).behavior).toBe('allow')
    expect((await canUse('mcp__wgr__http_admin_api', { method: 'GET', path: '/mgmt/agents' }, callOpts)).behavior).toBe('allow')
  })

  it('treats ssh_exec mutating flag correctly', async () => {
    const { canUse, confirm } = make({ autoApprove: true })
    expect((await canUse('mcp__wgr__ssh_exec', { command: 'ls', mutating: false }, callOpts)).behavior).toBe('allow')
    expect((await canUse('mcp__wgr__ssh_exec', { command: 'rm x', mutating: true }, callOpts)).behavior).toBe('allow')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('denies mutations in dry-run with an explanatory message', async () => {
    const { canUse, confirm } = make({ dryRun: true })
    const r = await canUse('mcp__wgr__ssh_put', { remotePath: '/etc/x', content: 'y' }, callOpts)
    expect(r.behavior).toBe('deny')
    if (r.behavior === 'deny') expect(r.message).toContain('[dry-run]')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirms ordinary mutations when not auto-approved', async () => {
    const yes = make({ confirm: vi.fn<ConfirmFn>(async () => true) })
    expect((await yes.canUse('mcp__wgr__ssh_put', { remotePath: '/x', content: 'y' }, callOpts)).behavior).toBe('allow')
    expect(yes.confirm).toHaveBeenCalledOnce()

    const no = make({ confirm: vi.fn<ConfirmFn>(async () => false) })
    expect((await no.canUse('mcp__wgr__ssh_put', { remotePath: '/x', content: 'y' }, callOpts)).behavior).toBe('deny')
  })

  it('always confirms a destructive call even with --yes', async () => {
    const { canUse, confirm } = make({ autoApprove: true, confirm: vi.fn<ConfirmFn>(async () => false) })
    const r = await canUse('mcp__wgr__http_admin_api', { method: 'DELETE', path: '/mgmt/agents/abc' }, callOpts)
    expect(confirm).toHaveBeenCalledOnce()
    expect(r.behavior).toBe('deny')
  })
})
