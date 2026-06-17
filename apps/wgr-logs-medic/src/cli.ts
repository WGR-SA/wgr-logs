#!/usr/bin/env node
import { Command } from 'commander'
import { LokiClient } from '@wgr/logs-client'
import { loadEnv, requireApi, requireLoki, requireGithub } from './config/env.js'
import { loadProjects, fixEligible } from './config/projects.js'
import { runScan } from './scan/scanner.js'
import { lokiReader, postProblem, getProblem } from './api/problems.js'
import { listRemediations } from './api/remediations.js'
import { runFix, resumeFix } from './fix/run.js'
import { runAuto } from './auto/run.js'
import type { Problem } from './types.js'

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
    let successes = 0
    let failures = 0
    for (const scan of scans) {
      for (const c of scan.candidates) {
        try {
          await postProblem(api, scan.project, c)
          successes++
        } catch (err: unknown) {
          failures++
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`[${scan.project}] Warning: failed to upsert problem — ${msg}\n`)
        }
      }
    }
    process.stderr.write(`\nUpserted ${successes} problems (${failures} failures).\n`)
    if (failures > 0) process.exitCode = 1
  })

program
  .command('fix')
  .description('Fix one triaged problem and open a PR')
  .requiredOption('--project <name>', 'project name (from projects.yml)')
  .option('--id <problemId>', 'problem id to fix')
  .option('--projects <path>', 'path to projects.yml')
  .option('--resume <remediationId>', 'resume an existing remediation on new PR comments')
  .action(async (flags: { project: string; id?: string; projects?: string; resume?: string }) => {
    if (flags.resume) {
      const env = loadEnv()
      const api = requireApi(env)
      const github = requireGithub(env)
      const project = loadProjects(flags.projects).find((p) => p.name === flags.project)
      if (!project || !fixEligible(project)) throw new Error(`unknown or non-fix-eligible project: ${flags.project}`)
      const { prUrl } = await resumeFix({ api, github, target: project, remediationId: Number.parseInt(flags.resume, 10) })
      process.stderr.write(`\nResumed; PR updated: ${prUrl}\n`)
      return
    }
    if (!flags.id) throw new Error('provide --id <problemId>')
    const env = loadEnv()
    const api = requireApi(env)
    const github = requireGithub(env)
    const project = loadProjects(flags.projects).find((p) => p.name === flags.project)
    if (!project) throw new Error(`unknown project: ${flags.project}`)
    if (!fixEligible(project)) throw new Error(`project ${project.name} has no repo configured (not fix-eligible)`)
    const problem = await getProblem(api, project.name, Number.parseInt(flags.id, 10))
    const { prUrl } = await runFix({ api, github, target: project, problem })
    process.stderr.write(`\nPR opened: ${prUrl}\n`)
  })

program
  .command('remediations')
  .description('List remediations for a project')
  .requiredOption('--project <name>', 'project name')
  .option('--projects <path>', 'path to projects.yml')
  .action(async (flags: { project: string; projects?: string }) => {
    const env = loadEnv()
    const api = requireApi(env)
    const rems = await listRemediations(api, flags.project)
    for (const r of rems) {
      process.stderr.write(`  #${r.id}  ${r.status}  ${r.prUrl ?? '-'}  $${r.costUsd.toFixed(2)}\n`)
    }
  })

program
  .command('auto')
  .description('Autonomously resume flagged PRs and fix the easiest unhandled problems (serial, sandboxed)')
  .option('--projects <path>', 'path to projects.yml')
  .option('--max <n>', 'max new fixes this pass', '1')
  .action(async (flags: { projects?: string; max: string }) => {
    const env = loadEnv()
    const api = requireApi(env)
    const github = requireGithub(env)
    const loki = requireLoki(env)
    const all = loadProjects(flags.projects)
    const targets = all.filter(fixEligible)
    const client = new LokiClient({ baseUrl: loki.baseUrl, basicAuth: { username: 'wgr', password: loki.token } })

    const result = await runAuto({
      targets,
      scan: async (project) => {
        const t = targets.find((x) => x.name === project)!
        const scans = await runScan({ projects: [t], reader: lokiReader(client), windowMs: 120 * 60_000, now: Date.now() })
        for (const c of scans[0]?.candidates ?? []) await postProblem(api, project, c)
      },
      listProblems: async (project) => {
        const res = await fetch(`${api.url}/projects/${encodeURIComponent(project)}/problems`, { headers: { Authorization: `Bearer ${api.adminToken}` } })
        if (!res.ok) throw new Error(`list problems failed: ${res.status}`)
        return (await res.json()) as Problem[]
      },
      listRemediations: (project) => listRemediations(api, project),
      fix: async ({ target, problem }) => runFix({ api, github, target, problem }),
      resume: async ({ target, remediationId }) => resumeFix({ api, github, target, remediationId }),
      max: Number.parseInt(flags.max, 10),
    })
    process.stderr.write(`\nauto: resumed ${result.resumed}, fixed ${result.fixed}\n`)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
