import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError } from '../lib/errors.js'
import { docBundlePaths } from '../tools/shipperAssets.js'
import type { Intent, TaskBrief } from './types.js'

const INVARIANTS_MARKER = join('assets', 'prompts', 'system.invariants.md')

export function findAgentRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, INVARIANTS_MARKER))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new ConfigError('Could not locate the agent root (assets/prompts/system.invariants.md not found).')
}

function readPrompt(agentRoot: string, ...segments: string[]): string {
  return readFileSync(join(agentRoot, 'assets', 'prompts', ...segments), 'utf8')
}

/**
 * Assemble the per-session system prompt: hard invariants + intent steps + the
 * repo doc bundle + the serialized TaskBrief. The agent reasons from these docs.
 */
export function buildSystemPrompt(brief: TaskBrief, repoRoot: string, agentRoot: string = findAgentRoot()): string {
  const invariants = readPrompt(agentRoot, 'system.invariants.md')
  const intentDoc = readPrompt(agentRoot, 'intents', `${brief.intent}.md`)

  const docs = docBundlePaths(repoRoot)
    .map((p) => `### ${basename(p)}\n\n${readFileSync(p, 'utf8')}`)
    .join('\n\n')

  return [
    invariants,
    `## Intent: ${brief.intent}`,
    intentDoc,
    '## TaskBrief',
    '```json',
    JSON.stringify(briefForPrompt(brief), null, 2),
    '```',
    '## Project documentation (source of truth — if reality contradicts a doc, report it instead of acting)',
    docs,
  ].join('\n\n')
}

/** Strip nothing secret (targets hold no secrets), but keep the prompt compact. */
function briefForPrompt(brief: TaskBrief): Record<string, unknown> {
  return {
    intent: brief.intent,
    target: brief.target,
    flags: { dryRun: brief.flags.dryRun, yes: brief.flags.yes, issue: brief.flags.issue },
  }
}

export function defaultModelFor(intent: Intent): string {
  return intent === 'diagnose' || intent === 'repair' ? 'claude-opus-4-8' : 'claude-sonnet-4-6'
}
