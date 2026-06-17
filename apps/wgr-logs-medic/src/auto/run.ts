import type { FixTarget } from '../config/projects.js'
import type { Problem, Remediation } from '../types.js'
import { selectNext } from './select.js'

export interface AutoDeps {
  targets: readonly FixTarget[]
  scan: (project: string) => Promise<void>
  listProblems: (project: string) => Promise<Problem[]>
  listRemediations: (project: string) => Promise<Remediation[]>
  fix: (args: { target: FixTarget; problem: Problem }) => Promise<{ prUrl: string; remediationId: number }>
  resume: (args: { target: FixTarget; remediationId: number }) => Promise<{ prUrl: string }>
  max: number
}

export interface AutoResult {
  resumed: number
  fixed: number
}

/** One autonomous pass: resume any flagged remediations, then fix up to `max` easiest unhandled problems (serial). */
export async function runAuto(deps: AutoDeps): Promise<AutoResult> {
  let resumed = 0
  let fixed = 0

  for (const target of deps.targets) {
    const rems = await deps.listRemediations(target.name)
    for (const r of rems.filter((x) => x.status === 'changes_requested')) {
      await deps.resume({ target, remediationId: r.id })
      resumed += 1
    }
  }

  while (fixed < deps.max) {
    let picked: { target: FixTarget; problem: Problem } | null = null
    for (const target of deps.targets) {
      await deps.scan(target.name)
      const [problems, rems] = await Promise.all([deps.listProblems(target.name), deps.listRemediations(target.name)])
      const problem = selectNext(problems, rems)
      if (problem) {
        picked = { target, problem }
        break
      }
    }
    if (!picked) break
    await deps.fix(picked)
    fixed += 1
  }

  return { resumed, fixed }
}
