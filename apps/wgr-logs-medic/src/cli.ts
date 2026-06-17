#!/usr/bin/env node
import { Command } from 'commander'
import { LokiClient } from '@wgr/logs-client'
import { loadEnv, requireApi, requireLoki } from './config/env.js'
import { loadProjects } from './config/projects.js'
import { runScan } from './scan/scanner.js'
import { lokiReader, postProblem } from './api/problems.js'

const program = new Command()
program.name('wgr-logs-medic').description('Watch Loki, triage recurring problems per project').version('0.1.0')

program
  .command('scan')
  .description('Scan Loki for recurring problems and upsert them to the API')
  .option('--projects <path>', 'path to projects.yml')
  .option('--window <minutes>', 'lookback window in minutes', '60')
  .option('--dry-run', 'print candidates, do not POST to the API')
  .action(async (flags: { projects?: string; window: string; dryRun?: boolean }) => {
    const env = loadEnv()
    const loki = requireLoki(env)
    const projects = loadProjects(flags.projects)
    const client = new LokiClient({ baseUrl: loki.baseUrl, basicAuth: { username: 'wgr', password: loki.token } })
    const scans = await runScan({
      projects,
      reader: lokiReader(client),
      windowMs: Number.parseInt(flags.window, 10) * 60_000,
      now: Date.now(),
    })

    for (const scan of scans) {
      process.stderr.write(`\n[${scan.project}] ${scan.candidates.length} problems (easiest first):\n`)
      for (const c of scan.candidates.slice(0, 20)) {
        process.stderr.write(`  ${c.fixabilityScore.toFixed(2)}  x${c.count}  ${c.category}  ${c.file ?? '-'}:${c.line ?? '-'}\n`)
      }
    }

    if (flags.dryRun) return
    const api = requireApi(env)
    for (const scan of scans) {
      for (const c of scan.candidates) await postProblem(api, scan.project, c)
    }
    process.stderr.write('\nUpserted to the API.\n')
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
