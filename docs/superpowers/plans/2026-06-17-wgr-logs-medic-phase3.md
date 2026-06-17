# wgr-logs-medic — Phase 3 (Autonomous, sbx-sandboxed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the medic autonomous and sandboxed — run the fix agent as native `claude` inside a Docker Sandbox (`sbx`) microVM (egress-locked, no host secrets), auto-select the easiest unhandled problem across allowlisted projects and fix it → PR, and react to PR feedback via a GitHub webhook.

**Architecture:** The agent run moves into `sbx` (host does clone/strip/verify/push, reusing all of Phase 2); a new deterministic `auto` loop scans + selects + drives the sandboxed fix; a NestJS `webhooks` module captures GitHub PR events (HMAC-verified) and flags remediations for the loop to resume. Only the SDK `query()` calls in `run.ts` are replaced — `buildFixPrompt`, `parseFixResult`, `verify`, `publish`, `withClone`, the clone-creds-strip are reused unchanged.

**Tech Stack:** TypeScript strict, ESM (NodeNext) medic + Vitest; Docker Sandboxes `sbx` (v0.33.x) for the agent; NestJS + TypeORM + Postgres for the API + webhook; reuses Phase 2's fix pipeline.

**Spec:** [`docs/superpowers/specs/2026-06-17-wgr-logs-medic-phase3-design.md`](../specs/2026-06-17-wgr-logs-medic-phase3-design.md).

## Global Constraints

- TypeScript strict; no unjustified `any`; eslint `--max-warnings=0` (medic lints `src/**`).
- Medic ESM NodeNext (`.js` local imports, `import type`); API bare imports + `nest build`.
- English identifiers; rare comments; validate only at external boundaries.
- **Sandbox is the only agent path.** The agent runs as `claude` inside `sbx`; egress allowlist = `api.anthropic.com` only; the Anthropic key is an `sbx secret` (proxy-injected, never in the VM); the GitHub token + clone + push + verify stay host-side; the clone's creds are stripped before the sandbox (Phase 2 `withClone` already does this).
- **Webhook auth = HMAC** (`X-Hub-Signature-256` vs `GITHUB_WEBHOOK_SECRET`); NO AdminGuard on the webhook route; the route reads the **raw body** (parse GitHub JSON manually — the global `forbidNonWhitelisted` ValidationPipe must not see it).
- Serial: one fix in flight. Human merges every PR. Dedup by remediation state; never auto-merge.
- `sbx` exact flags (policy scoping, `run` vs `exec`, how `claude -p` emits the result) are confirmed at the live task; the pure arg-builders are unit-tested; the `sbx` subprocess sits behind the injected `Runner` (from `fix/git.ts`).

## File structure

```
apps/wgr-logs-medic/src/
  fix/sbx.ts            (create: sbx arg-builders + runAgentInSandbox)
  fix/run.ts            (modify: replace runQuery/resumeQuery/generateContext with sbx)
  auto/select.ts        (create: selectNext, pure)
  auto/run.ts           (create: runAuto orchestrator)
  types.ts              (modify: Remediation.pendingComment)
  api/remediations.ts   (modify: pendingComment in body type; reuse listRemediations)
  cli.ts                (modify: `auto` command)
apps/wgr-logs-medic/tests/
  sbx.test.ts  select.test.ts  auto-run.test.ts

apps/wgr-logs-api/src/
  remediations/remediation.entity.ts     (modify: pending_comment column)
  remediations/remediations.service.ts   (modify: findByPrNumber + applyWebhookEvent)
  webhooks/github-signature.ts           (create: pure HMAC verify)
  webhooks/webhooks.service.ts           (create)
  webhooks/webhooks.controller.ts        (create)
  webhooks/webhooks.module.ts            (create)
  main.ts                                 (modify: rawBody: true)
  app.module.ts                           (modify: WebhooksModule)
```

---

## Task 1: Medic — sbx adapter (arg-builders + lifecycle)

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/sbx.ts`
- Test: `apps/wgr-logs-medic/tests/sbx.test.ts`

**Interfaces:**
- Consumes: `Runner`, `execRunner` from `./git.js`.
- Produces: pure `sbxCreateArgs`, `sbxPolicyAllowArgs`, `sbxRunClaudeArgs`, `sbxRmArgs`; `runAgentInSandbox(opts, run?): Promise<{ resultText: string }>`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/sbx.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { sbxCreateArgs, sbxPolicyAllowArgs, sbxRunClaudeArgs, sbxRmArgs } from '../src/fix/sbx.js'

describe('sbx arg builders', () => {
  it('creates a named claude sandbox over a workspace dir', () => {
    expect(sbxCreateArgs('med-123', '/tmp/clone')).toEqual(['create', '--name', 'med-123', 'claude', '/tmp/clone'])
  })
  it('allows only the anthropic domain, scoped to the sandbox', () => {
    expect(sbxPolicyAllowArgs('med-123', 'api.anthropic.com')).toEqual(['policy', 'allow', '--sandbox', 'med-123', 'network', 'api.anthropic.com'])
  })
  it('runs claude headless with the prompt after the -- separator', () => {
    expect(sbxRunClaudeArgs('med-123', 'FIXPROMPT')).toEqual(['run', '--name', 'med-123', '--', '-p', 'FIXPROMPT'])
  })
  it('removes the sandbox', () => {
    expect(sbxRmArgs('med-123')).toEqual(['rm', '--force', 'med-123'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- sbx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/sbx.ts`**

```typescript
import { type Runner, execRunner } from './git.js'

/** Build the `sbx` arg arrays. Exact flags confirmed at the live task; kept pure + tested. */
export function sbxCreateArgs(name: string, workspace: string): string[] {
  return ['create', '--name', name, 'claude', workspace]
}
export function sbxPolicyAllowArgs(name: string, domain: string): string[] {
  return ['policy', 'allow', '--sandbox', name, 'network', domain]
}
export function sbxRunClaudeArgs(name: string, prompt: string): string[] {
  return ['run', '--name', name, '--', '-p', prompt]
}
export function sbxRmArgs(name: string): string[] {
  return ['rm', '--force', name]
}

export interface SandboxOptions {
  name: string
  workspace: string
  prompt: string
  allowDomain?: string
}

/** Create an egress-locked claude sandbox over `workspace`, run the prompt headless, capture stdout, always clean up. */
export async function runAgentInSandbox(opts: SandboxOptions, run: Runner = execRunner): Promise<{ resultText: string }> {
  const sbx = async (args: string[]): Promise<string> => {
    const res = await run('sbx', args)
    if (res.code !== 0) throw new Error(`sbx ${args[0]} failed: ${res.stderr.trim()}`)
    return res.stdout
  }
  await sbx(sbxCreateArgs(opts.name, opts.workspace))
  try {
    await sbx(sbxPolicyAllowArgs(opts.name, opts.allowDomain ?? 'api.anthropic.com'))
    const resultText = await sbx(sbxRunClaudeArgs(opts.name, opts.prompt))
    return { resultText }
  } finally {
    await run('sbx', sbxRmArgs(opts.name)) // best-effort cleanup
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- sbx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic
git add apps/wgr-logs-medic/src/fix/sbx.ts apps/wgr-logs-medic/tests/sbx.test.ts
git commit -m "feat(medic): sbx sandbox adapter (egress-locked claude run)"
```

---

## Task 2: Medic — route the fixer through sbx (replace SDK calls)

**Files:**
- Modify: `apps/wgr-logs-medic/src/fix/run.ts`

**Interfaces:**
- Consumes: `runAgentInSandbox` (Task 1), `buildFixPrompt`/`buildResumePrompt`/`parseFixResult` (existing `fixer.js`), `withClone`/`verify`/`publish`/`branchName`/`execRunner`/`cloneUrl` (existing).
- Produces: `runFix`/`resumeFix` unchanged signatures; the agent run now goes through `sbx`.

This task swaps the three SDK call sites for the sandbox. The orchestration (clone, strip, ensureProjectContext, verify, publish, remediation updates) is reused.

- [ ] **Step 1: Replace the SDK helpers** — in `apps/wgr-logs-medic/src/fix/run.ts`, remove the `query` import and the `runQuery`/`resumeQuery`/`generateContext` functions, and replace them with sbx-backed versions. Add at top:

```typescript
import { runAgentInSandbox } from './sbx.js'
```
Remove `import { query } from '@anthropic-ai/claude-agent-sdk'` and the `scrubbedAgentEnv` usages in the query options (keep the `scrubbedAgentEnv` export if referenced elsewhere; otherwise leave it — harmless). Replace the three helpers with:

```typescript
let sandboxSeq = 0
function sandboxName(): string {
  sandboxSeq += 1
  return `medic-${process.pid}-${sandboxSeq}`
}

/** Run the fix agent in an egress-locked sbx microVM over the clone; return the agent's final text. */
async function runAgent(prompt: string, cwd: string): Promise<string> {
  const out = await runAgentInSandbox({ name: sandboxName(), workspace: cwd, prompt })
  return out.resultText
}
```

- [ ] **Step 2: Use `runAgent` in `runFix`** — where `runFix` previously called `runFixer({ prompt, cwd: dir }, (p, c) => runQuery(p, c))` (or similar), replace the agent invocation so it builds the prompt, runs the sandbox, and parses the result:

```typescript
        const context = await ensureProjectContext(/* unchanged deps */)
        const prompt = buildFixPrompt({ repoPath, category: problem.category, sample: problem.sample, context })
        const resultText = await runAgent(prompt, dir)
        const raw = parseFixResult(resultText)
        const fix: FixResult = {
          prTitle: raw.prTitle,
          prBody: raw.prBody,
          summary: raw.summary,
          changedFiles: raw.changedFiles,
          notVerified: null,
          sessionId: null,
          costUsd: 0,
        }
```
(`sessionId`/`costUsd` are no longer SDK-sourced; the webhook-driven resume re-runs the agent fresh, so `sessionId` is unused — keep the field as `null`. Import `parseFixResult` + `FixResult` from `./fixer.js` if not already.)

- [ ] **Step 3: Use `runAgent` in `resumeFix`** — replace its `resumeQuery(...)` call with: build the resume prompt from the captured comment, run the sandbox over the re-cloned branch, parse the result:

```typescript
        const prompt = buildResumePrompt(comments)
        const resultText = await runAgent(prompt, dir)
        const fix = parseFixResult(resultText)
```
(`comments` comes from the remediation's `pendingComment` in the auto path, or `gh pr view --comments` in the manual path — keep whichever the existing code uses; both are fine. Drop the `sessionId` resume wiring.)

- [ ] **Step 4: Context generation via sbx** — `generateContext(dir)` becomes a sandboxed read-only claude run:

```typescript
async function generateContext(dir: string): Promise<string> {
  const prompt = 'Read this repository and produce a concise CLAUDE.md (under 400 words): stack, key directories, conventions, how to run tests. Output only the markdown, no fences.'
  return runAgent(prompt, dir)
}
```

- [ ] **Step 5: Typecheck + lint + build + existing tests**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run test -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic`
Expected: all green. The existing `fixer.test.ts`/`publish.test.ts`/etc. still pass (those units are unchanged). `run.ts` is integration-gated by typecheck/build.

> Note: if removing the SDK import leaves `@anthropic-ai/claude-agent-sdk` unused project-wide, you MAY drop it from `package.json` as cleanup — but only if `grep -rn claude-agent-sdk apps/wgr-logs-medic/src` is empty. Otherwise leave it.

- [ ] **Step 6: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/run.ts apps/wgr-logs-medic/package.json package-lock.json
git commit -m "feat(medic): run the fix agent inside the sbx sandbox"
```

---

## Task 3: Medic — auto-selection (`auto/select.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/auto/select.ts`
- Test: `apps/wgr-logs-medic/tests/select.test.ts`

**Interfaces:**
- Consumes: `Problem`, `Remediation` (types.js).
- Produces: `selectNext(problems, remediations): Problem | null` — the easiest unhandled problem.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/select.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { selectNext } from '../src/auto/select.js'
import type { Problem, Remediation } from '../src/types.js'

const P = (id: number, score: number, count: number, signature: string): Problem => ({
  id, project: 'p', signature, patternHash: null, tech: null, category: 'Notice',
  file: '/x.ctp', line: 1, sample: 's', count, fixabilityScore: score, status: 'open',
})
const R = (problemId: number, status: string): Remediation => ({
  id: problemId * 10, problemId, repo: 'r', branch: null, prUrl: null, prNumber: null,
  sessionId: null, status: status as Remediation['status'], costUsd: 0, summary: null,
  diffStat: null, notVerified: null, pendingComment: null,
})

describe('selectNext', () => {
  it('picks the highest fixability among unhandled problems', () => {
    const got = selectNext([P(1, 0.5, 9, 'a'), P(2, 0.9, 3, 'b'), P(3, 0.7, 1, 'c')], [])
    expect(got?.id).toBe(2)
  })
  it('skips problems with an active or terminal remediation', () => {
    const got = selectNext([P(1, 0.9, 9, 'a'), P(2, 0.6, 3, 'b')], [R(1, 'pr_open')])
    expect(got?.id).toBe(2)
  })
  it('treats fixing/merged/wontfix/needs_input/changes_requested as handled', () => {
    for (const s of ['fixing', 'merged', 'wontfix', 'needs_input', 'changes_requested']) {
      expect(selectNext([P(1, 0.9, 9, 'a')], [R(1, s)])).toBeNull()
    }
  })
  it('re-selects a problem whose only remediation failed', () => {
    expect(selectNext([P(1, 0.9, 9, 'a')], [R(1, 'failed')])?.id).toBe(1)
  })
  it('returns null when nothing is selectable', () => {
    expect(selectNext([], [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- select`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/auto/select.ts`**

```typescript
import type { Problem, Remediation } from '../types.js'

const HANDLED = new Set(['fixing', 'pr_open', 'needs_input', 'changes_requested', 'merged', 'wontfix'])

/** The easiest unhandled problem: highest fixabilityScore (tie: count), excluding any with an active/terminal remediation. */
export function selectNext(problems: readonly Problem[], remediations: readonly Remediation[]): Problem | null {
  const handled = new Set(remediations.filter((r) => HANDLED.has(r.status)).map((r) => r.problemId))
  const candidates = problems
    .filter((p) => !handled.has(p.id))
    .sort((a, b) => b.fixabilityScore - a.fixabilityScore || b.count - a.count)
  return candidates[0] ?? null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- select`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/auto/select.ts apps/wgr-logs-medic/tests/select.test.ts
git commit -m "feat(medic): auto-select easiest unhandled problem"
```

---

## Task 4: Medic — `pendingComment` on the Remediation type + client

**Files:**
- Modify: `apps/wgr-logs-medic/src/types.ts`
- Modify: `apps/wgr-logs-medic/src/api/remediations.ts`

**Interfaces:**
- Produces: `Remediation.pendingComment: string | null`; `CreateRemediationBody.pendingComment?`.

- [ ] **Step 1: Extend `Remediation`** in `apps/wgr-logs-medic/src/types.ts` — add after `notVerified`:

```typescript
  pendingComment: string | null
```

- [ ] **Step 2: Allow patching it** in `apps/wgr-logs-medic/src/api/remediations.ts` — add `pendingComment?: string` to the `CreateRemediationBody` interface (so `updateRemediation(..., { pendingComment: undefined })` clears it after a resume; the API DTO will accept it in Task 7).

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic`
Expected: exit 0. (Existing `remediations-client.test.ts` still passes — the field is optional.)

- [ ] **Step 4: Commit**

```bash
git add apps/wgr-logs-medic/src/types.ts apps/wgr-logs-medic/src/api/remediations.ts
git commit -m "feat(medic): pendingComment on remediation (webhook resume seam)"
```

---

## Task 5: Medic — the `auto` loop (`auto/run.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/auto/run.ts`
- Test: `apps/wgr-logs-medic/tests/auto-run.test.ts`

**Interfaces:**
- Consumes: `selectNext` (Task 3), `FixTarget`, `Problem`, `Remediation`.
- Produces: `runAuto(deps): Promise<AutoResult>` — process pending resumes, then fix the easiest unhandled across projects, up to `max`. Dependencies injected for testability.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/auto-run.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { runAuto, type AutoDeps } from '../src/auto/run.js'
import type { Problem, Remediation } from '../src/types.js'

const target = { name: 'p', lokiSelector: '{a="b"}', repo: 'o/r' }
const P = (id: number, score: number): Problem => ({
  id, project: 'p', signature: 's' + id, patternHash: null, tech: null, category: 'Notice',
  file: '/x.ctp', line: 1, sample: 's', count: 1, fixabilityScore: score, status: 'open',
})
const R = (id: number, problemId: number, status: string): Remediation => ({
  id, problemId, repo: 'o/r', branch: 'b', prUrl: 'u', prNumber: 1, sessionId: null,
  status: status as Remediation['status'], costUsd: 0, summary: null, diffStat: null, notVerified: null, pendingComment: 'please rename',
})

function deps(over: Partial<AutoDeps>): AutoDeps {
  return {
    targets: [target],
    scan: vi.fn(async () => {}),
    listProblems: vi.fn(async () => [P(1, 0.9), P(2, 0.5)]),
    listRemediations: vi.fn(async () => []),
    fix: vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 })),
    resume: vi.fn(async () => ({ prUrl: 'pr' })),
    max: 1,
    ...over,
  }
}

describe('runAuto', () => {
  it('processes a pending resume before any new fix', async () => {
    const resume = vi.fn(async () => ({ prUrl: 'pr' }))
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const d = deps({ listRemediations: vi.fn(async () => [R(70, 1, 'changes_requested')]), resume, fix })
    const out = await runAuto(d)
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ remediationId: 70 }))
    expect(out.resumed).toBe(1)
  })
  it('fixes the easiest unhandled problem when no resumes pending', async () => {
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const out = await runAuto(deps({ fix }))
    expect(fix).toHaveBeenCalledWith(expect.objectContaining({ problem: expect.objectContaining({ id: 1 }) }))
    expect(out.fixed).toBe(1)
  })
  it('does nothing when all problems are handled', async () => {
    const fix = vi.fn(async () => ({ prUrl: 'pr', remediationId: 7 }))
    const out = await runAuto(deps({ listRemediations: vi.fn(async () => [R(10, 1, 'pr_open'), R(20, 2, 'merged')]), fix }))
    expect(fix).not.toHaveBeenCalled()
    expect(out.fixed).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- auto-run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/auto/run.ts`**

```typescript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- auto-run`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/auto/run.ts apps/wgr-logs-medic/tests/auto-run.test.ts
git commit -m "feat(medic): autonomous loop (resume + auto-fix easiest, serial)"
```

---

## Task 6: Medic — `auto` CLI command

**Files:**
- Modify: `apps/wgr-logs-medic/src/cli.ts`
- Modify: `apps/wgr-logs-medic/src/index.ts`

**Interfaces:**
- Consumes: `runAuto`, `runFix`, `resumeFix`, `loadProjects`/`fixEligible`, `requireApi`/`requireGithub`/`loadEnv`, the scan + remediation/problem clients.

- [ ] **Step 1: Add the `auto` command** in `apps/wgr-logs-medic/src/cli.ts` (after the existing commands). Wire the injected deps to the real scan + API + fix/resume:

```typescript
import { runAuto } from './auto/run.js'
import { listRemediations } from './api/remediations.js'
import { getProblem } from './api/problems.js'
// (scan helpers + LokiClient already imported for `scan`)

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
        return (await res.json()) as Awaited<ReturnType<typeof getProblem>>[]
      },
      listRemediations: (project) => listRemediations(api, project),
      fix: async ({ target, problem }) => runFix({ api, github, target, problem }),
      resume: async ({ target, remediationId }) => resumeFix({ api, github, target, remediationId }),
      max: Number.parseInt(flags.max, 10),
    })
    process.stderr.write(`\nauto: resumed ${result.resumed}, fixed ${result.fixed}\n`)
  })
```

(Reuse the existing imports already present in `cli.ts` for `runScan`, `lokiReader`, `postProblem`, `requireLoki`, `LokiClient`, `loadProjects`, `fixEligible`, `runFix`, `resumeFix`. Add any missing imports.)

- [ ] **Step 2: Export** — add to `apps/wgr-logs-medic/src/index.ts`:

```typescript
export { runAuto } from './auto/run.js'
export { selectNext } from './auto/select.js'
```

- [ ] **Step 3: Typecheck + lint + build + load smoke**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic && node apps/wgr-logs-medic/dist/cli.js auto --help`
Expected: all exit 0; `auto --help` prints `--max` + `--projects`.

- [ ] **Step 4: Commit**

```bash
git add apps/wgr-logs-medic/src/cli.ts apps/wgr-logs-medic/src/index.ts
git commit -m "feat(medic): `auto` CLI command (sandboxed autonomous pass)"
```

---

## Task 7: API — `pending_comment` + remediation webhook helpers

**Files:**
- Modify: `apps/wgr-logs-api/src/remediations/remediation.entity.ts`
- Modify: `apps/wgr-logs-api/src/remediations/dto/update-remediation.dto.ts`
- Modify: `apps/wgr-logs-api/src/remediations/remediations.service.ts`

**Interfaces:**
- Produces: `Remediation.pendingComment` column; `RemediationsService.findByPrNumber(prNumber)`, `applyWebhookEvent(...)`.

- [ ] **Step 1: Add the column** — in `apps/wgr-logs-api/src/remediations/remediation.entity.ts`, after `notVerified`:

```typescript
  @Column({ name: 'pending_comment', type: 'text', nullable: true })
  pendingComment!: string | null
```

- [ ] **Step 2: Allow it in the update DTO** — in `apps/wgr-logs-api/src/remediations/dto/update-remediation.dto.ts`, add:

```typescript
  @IsOptional() @IsString() pendingComment?: string
```
and in `remediations.service.ts` `update(...)`, add `if (dto.pendingComment !== undefined) existing.pendingComment = dto.pendingComment`.

- [ ] **Step 3: Add webhook helpers** — in `apps/wgr-logs-api/src/remediations/remediations.service.ts`:

```typescript
  findByPrNumber(prNumber: number): Promise<Remediation | null> {
    return this.remediations.findOne({ where: { prNumber }, relations: { problem: true } })
  }

  /** Apply a GitHub PR event to the matching remediation. Returns it, or null if no match. */
  async applyWebhookEvent(prNumber: number, event: { kind: 'comment'; comment: string } | { kind: 'merged' } | { kind: 'closed' }): Promise<Remediation | null> {
    const rem = await this.findByPrNumber(prNumber)
    if (!rem) return null
    if (event.kind === 'comment') {
      rem.status = 'changes_requested'
      rem.pendingComment = event.comment
    } else if (event.kind === 'merged') {
      rem.status = 'merged'
      if (rem.problem) rem.problem.status = 'merged'
    } else {
      rem.status = 'wontfix'
    }
    if (event.kind === 'merged' && rem.problem) await this.problems.save(rem.problem)
    return this.remediations.save(rem)
  }
```
Inject the `Problem` repo into the service constructor (add `@InjectRepository(Problem) private readonly problems: Repository<Problem>` and import `Problem`); register `Problem` in `RemediationsModule`'s `TypeOrmModule.forFeature([Remediation, Problem])`.

- [ ] **Step 4: Build**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-api/src/remediations
git commit -m "feat(api): pending_comment + webhook-event application on remediation"
```

---

## Task 8: API — GitHub webhook (HMAC verify + controller + module)

**Files:**
- Create: `apps/wgr-logs-api/src/webhooks/github-signature.ts`
- Create: `apps/wgr-logs-api/src/webhooks/webhooks.service.ts`
- Create: `apps/wgr-logs-api/src/webhooks/webhooks.controller.ts`
- Create: `apps/wgr-logs-api/src/webhooks/webhooks.module.ts`
- Modify: `apps/wgr-logs-api/src/main.ts`, `apps/wgr-logs-api/src/app.module.ts`

**Interfaces:**
- Produces: `POST /mgmt/webhooks/github` (HMAC-verified, raw-body), routes events to `RemediationsService.applyWebhookEvent`.

- [ ] **Step 1: Pure HMAC verify** — `apps/wgr-logs-api/src/webhooks/github-signature.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

/** Verify a GitHub `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw body + secret. */
export function verifyGithubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 2: Service** — `apps/wgr-logs-api/src/webhooks/webhooks.service.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { RemediationsService } from '../remediations/remediations.service'

@Injectable()
export class WebhooksService {
  constructor(private readonly remediations: RemediationsService) {}

  /** Map a parsed GitHub event to a remediation update. Returns true if a remediation matched. */
  async handle(eventName: string, payload: Record<string, unknown>): Promise<boolean> {
    const pr = (payload.pull_request ?? payload.issue) as { number?: number; pull_request?: unknown } | undefined
    const prNumber = typeof pr?.number === 'number' ? pr.number : undefined
    if (prNumber === undefined) return false

    if (eventName === 'issue_comment' && payload.action === 'created') {
      const body = ((payload.comment as { body?: string } | undefined)?.body ?? '').toString()
      return (await this.remediations.applyWebhookEvent(prNumber, { kind: 'comment', comment: body })) !== null
    }
    if (eventName === 'pull_request_review' && payload.action === 'submitted') {
      const body = ((payload.review as { body?: string } | undefined)?.body ?? '').toString()
      return (await this.remediations.applyWebhookEvent(prNumber, { kind: 'comment', comment: body })) !== null
    }
    if (eventName === 'pull_request' && payload.action === 'closed') {
      const merged = (payload.pull_request as { merged?: boolean } | undefined)?.merged === true
      return (await this.remediations.applyWebhookEvent(prNumber, merged ? { kind: 'merged' } : { kind: 'closed' })) !== null
    }
    return false
  }
}
```

- [ ] **Step 3: Controller** — `apps/wgr-logs-api/src/webhooks/webhooks.controller.ts` (raw body, HMAC, manual parse — NO DTO so the global ValidationPipe doesn't reject GitHub's payload):

```typescript
import { BadRequestException, Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { verifyGithubSignature } from './github-signature'
import { WebhooksService } from './webhooks.service'

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('github')
  @HttpCode(204)
  async github(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ): Promise<void> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (!secret) throw new UnauthorizedException('GITHUB_WEBHOOK_SECRET not configured')
    const raw = req.rawBody
    if (!raw) throw new BadRequestException('missing raw body')
    if (!verifyGithubSignature(raw, signature, secret)) throw new UnauthorizedException('bad signature')
    const payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    await this.service.handle(event ?? '', payload)
  }
}
```

- [ ] **Step 4: Module** — `apps/wgr-logs-api/src/webhooks/webhooks.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Remediation } from '../remediations/remediation.entity'
import { Problem } from '../problems/problem.entity'
import { RemediationsService } from '../remediations/remediations.service'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Remediation, Problem])],
  providers: [WebhooksService, RemediationsService],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
```

- [ ] **Step 5: Enable raw body** — in `apps/wgr-logs-api/src/main.ts`, change the bootstrap to capture the raw body:

```typescript
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true, rawBody: true })
```
(import `NestExpressApplication` from `@nestjs/platform-express`.) The global `ValidationPipe` stays; the webhook controller doesn't use a body DTO, so `forbidNonWhitelisted` never inspects the GitHub payload.

- [ ] **Step 6: Wire into `app.module.ts`** — import `WebhooksModule` and add it to `imports`.

- [ ] **Step 7: Build**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/wgr-logs-api/src/webhooks apps/wgr-logs-api/src/main.ts apps/wgr-logs-api/src/app.module.ts
git commit -m "feat(api): GitHub webhook (HMAC) drives PR-as-conversation"
```

---

## Task 9: Deploy API + operational live verification

**Files:** none (operational). Requires: `sbx login`, a dedicated capped `ANTHROPIC_API_KEY` in `sbx secret`, `GITHUB_WEBHOOK_SECRET` in the API `.env`, the repo webhook configured.

- [ ] **Step 1: Full medic gate**

```bash
npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run test -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-api
```
Expected: all green.

- [ ] **Step 2: Deploy the API** (new `webhooks` module + `pending_comment` column; `synchronize:true` adds the column). Per the deploy reality: push `main` → wait for `build-api.yml` → on the VPS `cd /home/debian/wgr-logs && docker compose pull api && docker compose up -d api`. Confirm `WebhooksController {/mgmt/webhooks}` route mapped + healthy. Set `GITHUB_WEBHOOK_SECRET` in the prod `.env` (compose env) and recreate the api container so it's present.

- [ ] **Step 3: sbx prerequisites** — `sbx login`; `sbx secret set anthropic` with a dedicated budget-capped key; verify `sbx version`.

- [ ] **Step 4: One sandboxed fix** (replaces the Phase 2 host run)

```bash
set -a; . ./.env; set +a
node apps/wgr-logs-medic/dist/cli.js fix --project prometerre --id <easiest>
```
Expected: a sandbox is created (`sbx ls` shows it mid-run), the agent edits inside the microVM, a PR opens, the sandbox is removed. Confirm via `sbx policy ls` that only `api.anthropic.com` was allowed. Adjust the `sbx.ts` arg-builders ONLY if the live `sbx` flags differ from the plan's best-known syntax (policy scoping flag, `run` vs `exec`, how `claude -p` emits the result) — then re-run.

- [ ] **Step 5: Configure the repo webhook** — GitHub repo → Settings → Webhooks → `https://<LOGS_DOMAIN>/mgmt/webhooks/github`, content-type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, events: issue comments, pull request reviews, pull requests. Comment on the open PR → confirm the remediation flips to `changes_requested` with the comment (`node dist/cli.js remediations --project prometerre`).

- [ ] **Step 6: One autonomous pass**

```bash
node apps/wgr-logs-medic/dist/cli.js auto --max 1
```
Expected: it resumes the `changes_requested` remediation (sandboxed) AND/OR fixes the next easiest problem; `auto: resumed N, fixed M`.

- [ ] **Step 7: Commit any arg-builder adjustments**

```bash
git add -A apps/wgr-logs-medic
git commit -m "test(medic): phase 3 verified — sandboxed fix + webhook resume + auto pass"
```

---

## Out of scope (later)
- **systemd 24/7 unit** + deploy via the agent CLI (tonight: `/loop 30m wgr-logs-medic auto`, supervised).
- Cross-project remediation **knowledge base**; desktop **UI**.

## Self-review notes
- Spec coverage: sbx sandbox (Tasks 1-2), auto-select (3) + loop (5) + CLI (6), multi-project (5 iterates targets), webhook (7-8), pending_comment seam (4,7), reuse of Phase 2 verify/publish/clone-strip (2). systemd/KB/UI deferred (matches spec §7).
- Type consistency: `Problem`/`Remediation` (+`pendingComment`) shared medic↔API; `AutoDeps.fix`/`resume` match `runFix`/`resumeFix` signatures; `selectNext` consumes the same `Remediation.status` union; `applyWebhookEvent` event kinds map to the `changes_requested|merged|wontfix` statuses the loop reads.
- Live-verify points (like Phase 2's SDK note): the exact `sbx` flags (Task 9 Step 4) — pure arg-builders are tested; the subprocess is injected. Webhook payload field paths (`pull_request.number`, `comment.body`, `merged`) confirmed against a real delivery in Task 9 Step 5.
