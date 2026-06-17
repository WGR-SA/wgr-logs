import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiConfig } from '../config/env.js'
import type { FixTarget } from '../config/projects.js'
import type { Problem } from '../types.js'
import { createRemediation, updateRemediation, listRemediations } from '../api/remediations.js'
import { getProjectContext, putProjectContext } from '../api/context.js'
import { mapServerPath } from './path-map.js'
import { withClone } from './clone.js'
import { ensureProjectContext } from './context.js'
import { buildFixPrompt, buildResumePrompt, parseFixResult, type FixResult } from './fixer.js'
import { verify } from './verify.js'
import { publish } from './publish.js'
import { branchName, execRunner, Git, Gh, cloneUrl } from './git.js'
import { redact } from '../scan/redact.js'
import { runAgentInSandbox } from './sbx.js'

const SECRET_KEYS = new Set([
  'WGR_GITHUB_TOKEN',
  'WGR_API_ADMIN_TOKEN',
  'WGR_API_REGISTER_TOKEN',
  'WGR_INGEST_TOKEN',
  'INGEST_AUTH_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
])

export function scrubbedAgentEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue
    if (SECRET_KEYS.has(k)) continue
    if (k !== 'ANTHROPIC_API_KEY' && /(_TOKEN|_SECRET|PASSWORD|APIKEY|_KEY)$/i.test(k)) continue
    out[k] = v
  }
  return out
}

let sandboxSeq = 0
function sandboxName(): string {
  sandboxSeq += 1
  return `medic-${process.pid}-${sandboxSeq}`
}

/** Run the fix agent as native claude inside an egress-locked sbx microVM over the clone; return its final text. */
async function runAgent(prompt: string, cwd: string): Promise<string> {
  const out = await runAgentInSandbox({ name: sandboxName(), workspace: cwd, prompt })
  return out.resultText
}

/** One-shot read-only understanding pass that returns a concise CLAUDE.md body. */
async function generateContext(dir: string): Promise<string> {
  const prompt =
    'Read this repository and produce a concise CLAUDE.md (under 400 words): stack, key directories, conventions, how to run tests. Output only the markdown, no fences.'
  const text = await runAgent(prompt, dir)
  return text.trim() || 'No context generated.'
}

export interface ResumeFixDeps {
  api: ApiConfig
  github: { token: string }
  target: FixTarget
  remediationId: number
}

export async function resumeFix(deps: ResumeFixDeps): Promise<{ prUrl: string }> {
  const { api, github, target, remediationId } = deps
  const rem = (await listRemediations(api, target.name)).find((r) => r.id === remediationId)
  if (!rem) throw new Error(`remediation ${remediationId} not found in project ${target.name}`)
  if (!rem.branch || !rem.prUrl) throw new Error(`remediation ${remediationId} has no branch/PR to resume`)

  try {
    return await withClone(
      target.repo,
      github.token,
      async (dir) => {
        const gh = new Gh(dir, github.token, execRunner)
        const comments = await gh.prComments(rem.prUrl as string)
        const resultText = await runAgent(buildResumePrompt(comments), dir)
        const fix = parseFixResult(resultText)

        const v = await verify(dir, fix.changedFiles, execRunner)
        const git = new Git(dir, execRunner)
        await git.addAll()
        await git.commit(redact(`${fix.prTitle} (review update)`))
        await git.push(rem.branch as string, cloneUrl(target.repo, github.token))

        await updateRemediation(api, remediationId, {
          status: 'pr_open',
          summary: fix.summary,
          notVerified: v.notVerified ?? undefined,
          costUsd: rem.costUsd,
        })
        return { prUrl: rem.prUrl as string }
      },
      execRunner,
      rem.branch,
    )
  } catch (err) {
    await updateRemediation(api, remediationId, { status: 'failed' })
    throw err
  }
}

export interface RunFixDeps {
  api: ApiConfig
  github: { token: string }
  target: FixTarget
  problem: Problem
}

export async function runFix(deps: RunFixDeps): Promise<{ prUrl: string; remediationId: number }> {
  const { api, github, target, problem } = deps
  const repoPath = problem.file ? mapServerPath(problem.file, target.pathPrefix) : null
  if (!repoPath) throw new Error(`cannot map problem file to a repo path: ${problem.file ?? '(none)'}`)

  const remediation = await createRemediation(api, target.name, { problemId: problem.id, repo: target.repo, status: 'fixing' })

  try {
    return await withClone(
      target.repo,
      github.token,
      async (dir) => {
        const context = await ensureProjectContext({
          repo: target.repo,
          tech: target.tech,
          dir,
          getCtx: (repo) => getProjectContext(api, repo),
          putCtx: (repo, body) => putProjectContext(api, repo, body),
          generate: (d) => generateContext(d),
          readClaudeMd: (d) => (existsSync(join(d, 'CLAUDE.md')) ? readFileSync(join(d, 'CLAUDE.md'), 'utf8') : null),
          writeClaudeMd: (summary) => writeFileSync(join(dir, 'CLAUDE.md'), summary),
        })

        const prompt = buildFixPrompt({ repoPath, category: problem.category, sample: problem.sample, context })
        const resultText = await runAgent(prompt, dir)
        const raw = parseFixResult(resultText)
        const fix: FixResult = { prTitle: raw.prTitle, prBody: raw.prBody, summary: raw.summary, changedFiles: raw.changedFiles, notVerified: null, sessionId: null, costUsd: 0 }

        const v = await verify(dir, fix.changedFiles, execRunner)
        fix.notVerified = v.notVerified

        const branch = branchName(problem.signature, Date.now())
        const published = await publish({ dir, repo: target.repo, token: github.token, base: target.defaultBranch ?? 'main', branch, fix })

        await updateRemediation(api, remediation.id, {
          branch: published.branch,
          prUrl: published.prUrl,
          sessionId: fix.sessionId ?? undefined,
          status: 'pr_open',
          costUsd: fix.costUsd,
          summary: fix.summary,
          diffStat: published.diffStat,
          notVerified: fix.notVerified ?? undefined,
        })
        return { prUrl: published.prUrl, remediationId: remediation.id }
      },
      execRunner,
    )
  } catch (err) {
    await updateRemediation(api, remediation.id, { status: 'failed' })
    throw err
  }
}
