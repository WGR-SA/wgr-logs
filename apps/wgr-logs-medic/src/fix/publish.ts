import { redact } from '../scan/redact.js'
import { Git, Gh, type Runner, execRunner } from './git.js'
import type { FixResult } from './fixer.js'

export interface PublishOptions {
  dir: string
  repo: string
  token: string
  base: string
  branch: string
  fix: FixResult
  run?: Runner
}

export interface PublishResult {
  prUrl: string
  branch: string
  diffStat: string
}

/** The single outward step: redact, branch, push, open PR. Deterministic — the fixer never does this. */
export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const run = opts.run ?? execRunner
  const git = new Git(opts.dir, run)
  const gh = new Gh(opts.dir, opts.token, run)

  await git.checkoutNewBranch(opts.branch)
  await git.addAll()
  await git.commit(opts.fix.prTitle)
  const diffStat = await git.diffStat(opts.base)
  await git.push(opts.branch)

  const body = redact(buildBody(opts.fix))
  const prUrl = await gh.prCreate({ title: opts.fix.prTitle, body, base: opts.base, head: opts.branch })
  return { prUrl, branch: opts.branch, diffStat }
}

function buildBody(fix: FixResult): string {
  const parts = [fix.prBody, '', `**Summary:** ${fix.summary}`]
  if (fix.notVerified) parts.push('', `**Not verified:** ${fix.notVerified}`)
  parts.push('', '_Opened by wgr-logs-medic. Review before merging._')
  return parts.join('\n')
}
