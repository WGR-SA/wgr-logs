#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { Command } from 'commander'
import { runIntent } from './agent/runIntent.js'
import { REPAIR_ISSUES, type Intent, type RepairIssue, type TaskBrief } from './agent/types.js'
import { loadEnv } from './config/env.js'
import { getTarget } from './config/targets.js'
import { AgentError } from './lib/errors.js'
import { createLogger } from './lib/logger.js'

interface CliFlags {
  live?: boolean
  yes?: boolean
  model?: string
  targets?: string
  issue?: string
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = (await rl.question(`\n${prompt}\nProceed? [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

async function run(intent: Intent, targetName: string, flags: CliFlags, mutating: boolean): Promise<void> {
  const logger = createLogger()
  try {
    const env = loadEnv()
    logger.redact(
      env.WGR_API_ADMIN_TOKEN,
      env.WGR_API_REGISTER_TOKEN,
      env.WGR_INGEST_TOKEN,
      env.INGEST_AUTH_TOKEN,
      env.ANTHROPIC_API_KEY,
    )
    const target = getTarget(targetName, flags.targets)

    let issue: RepairIssue | undefined
    if (intent === 'repair') {
      if (!flags.issue || !(REPAIR_ISSUES as readonly string[]).includes(flags.issue)) {
        throw new AgentError(`repair requires --issue <${REPAIR_ISSUES.join('|')}>`, 'CONFIG')
      }
      issue = flags.issue as RepairIssue
    }

    const dryRun = mutating ? !flags.live : false
    if (mutating && dryRun) logger.info('Dry-run mode: mutations will be reported, not executed. Pass --live to execute.')

    const brief: TaskBrief = {
      intent,
      target,
      flags: { dryRun, yes: Boolean(flags.yes), model: flags.model, issue },
    }

    const result = await runIntent(brief, { env, logger, confirm })
    logger.info(`\n— ${intent} terminé (${result.numTurns} tours) —`)
    if (result.resultText) logger.info(result.resultText)
    if (result.isError) process.exitCode = 1
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}

const program = new Command()
program
  .name('wgr-logs-agent')
  .description('Claude Agent SDK CLI to install & maintain the wgr-logs shipper on any server.')
  .version('0.1.0')

const mutatingCommand = (name: string, description: string): Command =>
  program
    .command(`${name} <target>`)
    .description(description)
    .option('--live', 'execute mutations (default: dry-run, which reports but does not apply)')
    .option('-y, --yes', 'skip confirmation for non-destructive mutations (deletions always prompt)')
    .option('--model <model>', 'override the Claude model')
    .option('--targets <path>', 'path to targets.yml')

mutatingCommand('install', 'Enrol the shipper on a target and verify it reaches Loki.').action(
  (target: string, flags: CliFlags) => run('install', target, flags, true),
)
mutatingCommand('refresh', 'Update the shipper scripts on a target and re-trigger a push.').action(
  (target: string, flags: CliFlags) => run('refresh', target, flags, true),
)
mutatingCommand('repair', 'Apply a guided fix for a known issue (--issue).')
  .requiredOption('--issue <issue>', `one of: ${REPAIR_ISSUES.join(', ')}`)
  .action((target: string, flags: CliFlags) => run('repair', target, flags, true))

program
  .command('diagnose <target>')
  .description('Read-only investigation of a target shipper (no mutations).')
  .option('--model <model>', 'override the Claude model')
  .option('--targets <path>', 'path to targets.yml')
  .action((target: string, flags: CliFlags) => run('diagnose', target, flags, false))

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
