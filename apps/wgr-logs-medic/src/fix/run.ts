import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ApiConfig } from '../config/env.js'
import type { FixTarget } from '../config/projects.js'
import type { Problem } from '../types.js'
import { createRemediation, updateRemediation } from '../api/remediations.js'
import { getProjectContext, putProjectContext } from '../api/context.js'
import { mapServerPath } from './path-map.js'
import { withClone } from './clone.js'
import { ensureProjectContext } from './context.js'
import { buildFixPrompt, runFixer, type QueryOutcome } from './fixer.js'
import { verify } from './verify.js'
import { publish } from './publish.js'
import { branchName, execRunner } from './git.js'

const FIX_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']

/** Drive one SDK session in `cwd` and collect the outcome. */
async function runQuery(prompt: string, cwd: string): Promise<QueryOutcome> {
  const iterator = query({
    prompt,
    options: {
      model: 'claude-opus-4-8',
      allowedTools: FIX_TOOLS,
      permissionMode: 'acceptEdits',
      settingSources: ['project'],
      cwd,
      effort: process.env.WGR_AGENT_EFFORT ? (process.env.WGR_AGENT_EFFORT as 'high') : 'high',
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
    options: { model: 'claude-opus-4-8', allowedTools: ['Read', 'Glob', 'Grep'], permissionMode: 'default', cwd: dir, effort: 'low' },
  })
  let text = ''
  for await (const message of iterator) {
    if (message.type === 'result' && message.subtype === 'success') text = message.result
  }
  return text.trim() || 'No context generated.'
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

  return withClone(
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
}
