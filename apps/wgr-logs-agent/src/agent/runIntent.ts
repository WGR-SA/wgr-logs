import { homedir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Env } from '../config/env.js'
import type { Logger } from '../lib/logger.js'
import { makeCanUseTool, type ConfirmFn } from '../safety/canUseTool.js'
import type { ToolContext } from '../tools/context.js'
import { buildToolServer, WGR_SERVER_NAME, WGR_TOOL_NAMES } from '../tools/index.js'
import { findRepoRoot } from '../tools/shipperAssets.js'
import { Ssh2Driver, type SshDriver } from '../tools/ssh.js'
import { buildInitialPrompt } from './intents/index.js'
import { buildSystemPrompt, defaultModelFor } from './systemPrompt.js'
import type { RunResult, TaskBrief } from './types.js'

export interface RunIntentDeps {
  env: Env
  logger: Logger
  confirm: ConfirmFn
  ssh?: SshDriver
  repoRoot?: string
  workspaceDir?: string
}

/** Built-in Claude Code tools that would let the agent act on the LOCAL machine — disabled. */
const DISABLED_BUILTINS = [
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
]

export async function runIntent(brief: TaskBrief, deps: RunIntentDeps): Promise<RunResult> {
  // No API-key check here: the SDK resolves auth from ANTHROPIC_API_KEY *or* a
  // Claude Code subscription login (OAuth). An auth failure surfaces below.
  const repoRoot = deps.repoRoot ?? findRepoRoot()
  const workspaceDir = deps.workspaceDir ?? join(homedir(), '.wgr-logs-agent', 'workspace')
  const ssh = deps.ssh ?? new Ssh2Driver()

  const ctx: ToolContext = { target: brief.target, env: deps.env, ssh, logger: deps.logger, repoRoot, workspaceDir }
  const server = buildToolServer(ctx)

  const model = brief.flags.model ?? deps.env.WGR_AGENT_MODEL ?? defaultModelFor(brief.intent)
  const canUseTool = makeCanUseTool({
    dryRun: brief.flags.dryRun,
    autoApprove: brief.flags.yes,
    confirm: deps.confirm,
    logger: deps.logger,
    targetLabel: `${brief.target.name} (${brief.target.ssh.host})`,
  })

  const abortController = new AbortController()
  const onSigint = (): void => abortController.abort()
  process.once('SIGINT', onSigint)

  let resultText = ''
  let isError = false
  let numTurns = 0
  let authFailed = false

  try {
    const iterator = query({
      prompt: buildInitialPrompt(brief),
      options: {
        model,
        systemPrompt: buildSystemPrompt(brief, repoRoot),
        mcpServers: { [WGR_SERVER_NAME]: server },
        allowedTools: [...WGR_TOOL_NAMES],
        disallowedTools: DISABLED_BUILTINS,
        canUseTool,
        permissionMode: 'default',
        cwd: repoRoot,
        abortController,
        ...(deps.env.WGR_AGENT_EFFORT ? { effort: deps.env.WGR_AGENT_EFFORT } : {}),
      },
    })

    for await (const message of iterator) {
      if (message.type === 'assistant') {
        if (message.error === 'authentication_failed') authFailed = true
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) deps.logger.info(block.text)
        }
      } else if (message.type === 'result') {
        numTurns = message.num_turns
        if (message.subtype === 'success') {
          resultText = message.result
        } else {
          isError = true
          resultText = `Run ended without success: ${message.subtype}`
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint)
  }

  if (authFailed) {
    isError = true
    resultText =
      'Authentification échouée. Connecte-toi avec `claude` (abonnement Pro/Max) ou exporte ANTHROPIC_API_KEY.'
  }

  return { resultText, isError, numTurns }
}
