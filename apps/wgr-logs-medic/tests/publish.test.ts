import { describe, expect, it } from 'vitest'
import { publish } from '../src/fix/publish.js'
import type { Runner } from '../src/fix/git.js'

function recordingRunner(prUrl: string) {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const run: Runner = async (cmd, args) => {
    calls.push({ cmd, args })
    if (cmd === 'gh' && args[0] === 'pr') return { stdout: prUrl, stderr: '', code: 0 }
    if (cmd === 'git' && args[0] === 'diff') return { stdout: ' 1 file changed', stderr: '', code: 0 }
    return { stdout: '', stderr: '', code: 0 }
  }
  return { run, calls }
}

describe('publish', () => {
  it('redacts the PR body, pushes the branch and opens the PR', async () => {
    const { run, calls } = recordingRunner('https://github.com/wgr-sa/p/pull/12')
    const out = await publish({
      dir: '/tmp/clone',
      repo: 'github.com/wgr-sa/p',
      token: 'TKN',
      base: 'main',
      branch: 'medic/fix-abcd-1',
      fix: { prTitle: 'Fix', prBody: 'leaked AKIAIOSFODNN7EXAMPLE in logs', summary: 's', changedFiles: ['x'], notVerified: null, sessionId: null, costUsd: 0 },
      run,
    })
    expect(out.prUrl).toBe('https://github.com/wgr-sa/p/pull/12')
    const prCreate = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'pr')!
    const bodyArg = prCreate.args[prCreate.args.indexOf('--body') + 1]
    expect(bodyArg).toContain('[REDACTED]')
    expect(bodyArg).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'push')).toBe(true)
  })
})
