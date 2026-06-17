import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ApiConfig } from '../config/env.js'
import type { FixTarget } from '../config/projects.js'
import type { Problem } from '../types.js'
import { createRemediation, updateRemediation, listRemediations } from '../api/remediations.js'
import { getProjectContext, putProjectContext } from '../api/context.js'
import { mapServerPath } from './path-map.js'
import { withClone } from './clone.js'
import { ensureProjectContext } from './context.js'
import { buildFixPrompt, buildResumePrompt, parseFixResult, runFixer, type QueryOutcome } from './fixer.js'
import { verify } from './verify.js'
import { publish } from './publish.js'
import { branchName, execRunner, Git, Gh, cloneUrl } from './git.js'
import { redact } from '../scan/redact.js'

const FIX_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']

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

/** Drive one SDK session in `cwd` and collect the outcome. */
async function runQuery(prompt: string, cwd: string): Promise<QueryOutcome> {
  const iterator = query({
    prompt,
    options: {
      model: 'claude-opus-4-8',
      tools: FIX_TOOLS,
      allowedTools: FIX_TOOLS,
      permissionMode: 'acceptEdits',
      cwd,
      effort: process.env.WGR_AGENT_EFFORT ? (process.env.WGR_AGENT_EFFORT as 'high') : 'high',
      maxTurns: Number(process.env.WGR_MEDIC_MAX_TURNS ?? '40'),
      maxBudgetUsd: Number(process.env.WGR_MEDIC_MAX_BUDGET_USD ?? '3'),
      env: scrubbedAgentEnv(),
    },
  })
  let resultText = ''
  let sessionId: string | null = null
  let costUsd = 0
  let success = false
  for await (const message of iterator) {
    if (message.type === 'result') {
      sessionId = message.session_id
      costUsd = message.total_cost_usd
      if (message.subtype === 'success') {
        resultText = message.result
        success = true
      }
    } else if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id
    }
  }
  return { resultText, sessionId, costUsd, success }
}

/** One-shot read-only understanding pass that returns a concise CLAUDE.md body. */
async function generateContext(dir: string): Promise<string> {
  const prompt =
    'Read this repository and produce a concise CLAUDE.md (under 400 words): stack, key directories, conventions, how to run tests. Output only the markdown, no fences.'
  const iterator = query({
    prompt,
    options: { model: 'claude-opus-4-8', tools: ['Read', 'Glob', 'Grep'], allowedTools: ['Read', 'Glob', 'Grep'], permissionMode: 'default', cwd: dir, effort: 'low', env: scrubbedAgentEnv() },
  })
  let text = ''
  for await (const message of iterator) {
    if (message.type === 'result' && message.subtype === 'success') text = message.result
  }
  return text.trim() || 'No context generated.'
}

async function resumeQuery(sessionId: string, prompt: string, cwd: string): Promise<QueryOutcome> {
  const iterator = query({
    prompt,
    options: {
      resume: sessionId,
      model: 'claude-opus-4-8',
      tools: FIX_TOOLS,
      allowedTools: FIX_TOOLS,
      permissionMode: 'acceptEdits',
      cwd,
      effort: 'high',
      maxTurns: Number(process.env.WGR_MEDIC_MAX_TURNS ?? '40'),
      maxBudgetUsd: Number(process.env.WGR_MEDIC_MAX_BUDGET_USD ?? '3'),
      env: scrubbedAgentEnv(),
    },
  })
  let resultText = ''
  let outId: string | null = sessionId
  let costUsd = 0
  let success = false
  for await (const message of iterator) {
    if (message.type === 'result') {
      outId = message.session_id ?? outId
      costUsd = message.total_cost_usd ?? 0
      if (message.subtype === 'success') {
        resultText = message.result
        success = true
      }
    }
  }
  return { resultText, sessionId: outId, costUsd, success }
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
  if (!rem.sessionId || !rem.branch || !rem.prUrl) throw new Error(`remediation ${remediationId} has no session/branch/PR to resume`)

  try {
    return await withClone(
      target.repo,
      github.token,
      async (dir) => {
        const gh = new Gh(dir, github.token, execRunner)
        const comments = await gh.prComments(rem.prUrl as string)
        const outcome = await resumeQuery(rem.sessionId as string, buildResumePrompt(comments), dir)
        if (!outcome.success) throw new Error('resume session did not complete')
        const fix = parseFixResult(outcome.resultText)

        const v = await verify(dir, fix.changedFiles, execRunner)
        const git = new Git(dir, execRunner)
        await git.addAll()
        await git.commit(redact(`${fix.prTitle} (review update)`))
        await git.push(rem.branch as string, cloneUrl(target.repo, github.token))

        await updateRemediation(api, remediationId, {
          status: 'pr_open',
          summary: fix.summary,
          notVerified: v.notVerified ?? undefined,
          sessionId: outcome.sessionId ?? undefined,
          costUsd: rem.costUsd + outcome.costUsd,
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
        const fix = await runFixer({ prompt, cwd: dir }, (p, cwd) => runQuery(p, cwd))

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
