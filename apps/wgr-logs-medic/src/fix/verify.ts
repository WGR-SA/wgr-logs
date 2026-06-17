import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Runner } from './git.js'

export interface Check {
  cmd: string
  args: string[]
}

/** Pure: decide which best-effort checks to run for the changed files. `dirHas(rel)` = file exists at repo root. */
export function planChecks(changedFiles: readonly string[], dirHas: (rel: string) => boolean): Check[] {
  const checks: Check[] = []
  for (const f of changedFiles) {
    if (f.endsWith('.php')) checks.push({ cmd: 'php', args: ['-l', f] })
  }
  if (dirHas('phpstan.neon') || dirHas('phpstan.neon.dist')) {
    checks.push({ cmd: 'vendor/bin/phpstan', args: ['analyse', '--no-progress'] })
  }
  if (dirHas('phpunit.xml') || dirHas('phpunit.xml.dist')) {
    checks.push({ cmd: 'vendor/bin/phpunit', args: ['--no-coverage'] })
  }
  return checks
}

export interface VerifyResult {
  ran: string[]
  ok: boolean
  notVerified: string | null
}

/** Best-effort: run each planned check; a missing tool (non-zero exit) is recorded, not fatal. */
export async function verify(dir: string, changedFiles: readonly string[], run: Runner): Promise<VerifyResult> {
  const plan = planChecks(changedFiles, (rel) => existsSync(join(dir, rel)))
  const ran: string[] = []
  const failures: string[] = []
  for (const c of plan) {
    // Best-effort: a missing binary makes the runner reject (spawn ENOENT) — record it, don't abort the fix.
    let res
    try {
      res = await run(c.cmd, c.args, { cwd: dir })
    } catch (err) {
      failures.push(`${c.cmd} (unavailable: ${err instanceof Error ? err.message : String(err)})`)
      continue
    }
    ran.push(`${c.cmd} ${c.args.join(' ')}`)
    if (res.code !== 0) failures.push(`${c.cmd} (${res.stderr.trim().slice(0, 200)})`)
  }
  const notVerified =
    plan.length === 0
      ? 'no automated checks available for this repo'
      : failures.length
        ? `checks failed/unavailable: ${failures.join('; ')}`
        : null
  return { ran, ok: failures.length === 0, notVerified }
}
