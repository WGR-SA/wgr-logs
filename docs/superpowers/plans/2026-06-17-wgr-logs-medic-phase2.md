# wgr-logs-medic — Phase 2 (Fix → PR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a triaged `problem` into one reviewed pull request on the matching repo — clone-edit-verify in a throwaway checkout via the Agent SDK, then publish the PR deterministically — while accruing cross-project memory (`tech`, `pattern_hash`, remediations, per-project context).

**Architecture:** A new `fix` module + CLI command in the ESM `apps/wgr-logs-medic` app drives an inner `query()` (Agent SDK) inside a disposable clone of the target repo; the medic's own deterministic code (not the agent) redacts and performs the outward `git push` + `gh pr create`. The NestJS API gains `remediation` + `project_context` entities/routes and two new columns on `problem`. Pure/deterministic units are TDD-tested; git/gh/SDK side-effects sit behind injected runners and are exercised at a deferred live end-to-end task.

**Tech Stack:** TypeScript strict, ESM (NodeNext) for medic + Vitest; `@anthropic-ai/claude-agent-sdk@^0.3.170`; `gh` CLI (invoked with `GH_TOKEN`) + `git` for the outward step; NestJS + TypeORM + Postgres for the API; `@wgr/logs-client` for Loki (unchanged).

**Spec:** [`docs/superpowers/specs/2026-06-17-wgr-logs-medic-phase2-design.md`](../specs/2026-06-17-wgr-logs-medic-phase2-design.md).

## Global Constraints

- TypeScript strict; no unjustified `any`; eslint `--max-warnings=0` (medic lints `src/**` only).
- Medic app: ESM NodeNext — local imports use `.js` extensions; type-only imports use `import type` (`verbatimModuleSyntax`). Package specifiers (`@anthropic-ai/...`, `commander`) have no `.js`.
- API app: bare relative imports (no `.js`); `nest build`; DTOs with class-validator; entities listed explicitly in `database.config.ts`; `ClassSerializerInterceptor` + `@Exclude()` to prevent leaks.
- English identifiers; rare comments (why, not what); no defensive code at internal boundaries; validate only at external boundaries (HTTP, env, files, subprocess output).
- **Safety (binding):** the SDK fixer has NO push/`gh`/network tools — only `Read,Edit,Write,Glob,Grep,Bash` on the clone. The outward step (`git push`, `gh pr create`) is the medic's deterministic code only. Repo allowlist = projects with a configured `repo`. PR-only `WGR_GITHUB_TOKEN`; NEVER push to the default branch. Throwaway clone only — never touch prod or `/data01`. Redact the PR body before publishing.
- Cross-project memory is **capture + per-project context only** this phase — no retrieval of other projects' fixes into the prompt.

## File structure

```
apps/wgr-logs-medic/src/
  config/env.ts                 (modify: WGR_GITHUB_TOKEN + requireGithub)
  config/projects.ts            (modify: tech, repo, defaultBranch, pathPrefix; fixEligible)
  types.ts                      (modify: patternHash on ParsedError/ProblemCandidate; tech on candidate; Remediation types)
  scan/signature.ts             (modify: emit patternHash)
  scan/scanner.ts               (modify: attach patternHash + tech to candidates)
  api/problems.ts               (modify: post body carries tech + patternHash; add getProblem)
  api/remediations.ts           (create: remediation client)
  api/context.ts                (create: project-context client)
  fix/path-map.ts               (create: serverPath -> repoPath, pure)
  fix/git.ts                    (create: git/gh command arg-building + injected runner)
  fix/clone.ts                  (create: throwaway clone lifecycle)
  fix/verify.ts                 (create: tiered best-effort verification)
  fix/context.ts                (create: generate + cache per-project understanding)
  fix/fixer.ts                  (create: inner query() -> FixResult)
  fix/publish.ts                (create: redact + push + gh pr create, deterministic)
  fix/run.ts                    (create: orchestrate one fix / one resume)
  cli.ts                        (modify: fix, fix --resume, remediations)
apps/wgr-logs-medic/tests/
  fix-config.test.ts  pattern-hash.test.ts  path-map.test.ts
  remediations-client.test.ts  git.test.ts  verify.test.ts
  context.test.ts  fixer.test.ts  publish.test.ts

apps/wgr-logs-api/src/
  problems/problem.entity.ts            (modify: tech, patternHash columns)
  problems/dto/upsert-problem.dto.ts    (modify: tech?, patternHash?)
  remediations/remediation.entity.ts    (create)
  remediations/dto/create-remediation.dto.ts (create)
  remediations/dto/update-remediation.dto.ts (create)
  remediations/remediations.service.ts  (create)
  remediations/remediations.controller.ts (create)
  remediations/remediations.module.ts   (create)
  project-context/project-context.entity.ts (create)
  project-context/dto/upsert-project-context.dto.ts (create)
  project-context/project-context.service.ts (create)
  project-context/project-context.controller.ts (create)
  project-context/project-context.module.ts (create)
  config/database.config.ts             (modify: register Remediation, ProjectContext)
  app.module.ts                         (modify: import the two modules)
```

---

## Task 1: Medic — SDK dependency + GitHub env

**Files:**
- Modify: `apps/wgr-logs-medic/package.json`
- Modify: `apps/wgr-logs-medic/src/config/env.ts`

**Interfaces:**
- Produces: `requireGithub(env): { token: string }`; env field `WGR_GITHUB_TOKEN`.

- [ ] **Step 1: Add the SDK dependency** — in `apps/wgr-logs-medic/package.json`, add to `"dependencies"` (keep alphabetical-ish, match the agent's version):

```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.170",
```

- [ ] **Step 2: Extend env** — in `apps/wgr-logs-medic/src/config/env.ts`, add `WGR_GITHUB_TOKEN` to `EnvSchema` (after `INGEST_AUTH_TOKEN`):

```typescript
  WGR_GITHUB_TOKEN: z.string().optional(),
```

Then add, after `requireLoki`:

```typescript
export interface GithubConfig {
  token: string
}
export function requireGithub(env: Env): GithubConfig {
  if (!env.WGR_GITHUB_TOKEN) throw new ConfigError('Set WGR_GITHUB_TOKEN (fine-grained PAT, contents + pull-requests, no push to default branch)')
  return { token: env.WGR_GITHUB_TOKEN }
}
```

(`ANTHROPIC_API_KEY` is read directly by the SDK from the environment — no schema entry needed.)

- [ ] **Step 3: Install + build**

Run: `npm install && npm run build -w @wgr/wgr-logs-medic`
Expected: install links the SDK, `dist/` emitted, exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/wgr-logs-medic/package.json apps/wgr-logs-medic/src/config/env.ts package-lock.json
git commit -m "feat(medic): add Agent SDK dep + WGR_GITHUB_TOKEN env"
```

---

## Task 2: Medic — per-project fix-config

**Files:**
- Modify: `apps/wgr-logs-medic/src/config/projects.ts`
- Test: `apps/wgr-logs-medic/tests/fix-config.test.ts`

**Interfaces:**
- Produces: `Project` gains `tech?`, `repo?`, `defaultBranch?`, `pathPrefix?`. `fixEligible(p): p is FixTarget` narrows to a project with a `repo`. `FixTarget = Project & { repo: string }`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/fix-config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { ProjectSchema, fixEligible } from '../src/config/projects.js'

const full = {
  name: 'prometerre',
  lokiSelector: '{host="ov-eda3ed", source="cakephp"}',
  tech: 'cakephp',
  repo: 'github.com/wgr-sa/prometerre',
  defaultBranch: 'main',
  pathPrefix: '/data01/sites/prometerre/prod/prometerre.ch',
}

describe('ProjectSchema (fix fields)', () => {
  it('parses the optional fix fields', () => {
    const p = ProjectSchema.parse(full)
    expect(p.tech).toBe('cakephp')
    expect(p.repo).toBe('github.com/wgr-sa/prometerre')
    expect(p.pathPrefix).toBe('/data01/sites/prometerre/prod/prometerre.ch')
  })

  it('still parses a triage-only project (no fix fields)', () => {
    const p = ProjectSchema.parse({ name: 'x', lokiSelector: '{a="b"}' })
    expect(p.repo).toBeUndefined()
  })
})

describe('fixEligible', () => {
  it('is true only when a repo is configured', () => {
    expect(fixEligible(ProjectSchema.parse(full))).toBe(true)
    expect(fixEligible(ProjectSchema.parse({ name: 'x', lokiSelector: '{a="b"}' }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- fix-config`
Expected: FAIL — `fixEligible` not exported / fields missing.

- [ ] **Step 3: Extend `apps/wgr-logs-medic/src/config/projects.ts`** — replace the `ProjectSchema` definition and add `fixEligible`:

```typescript
export const ProjectSchema = z.object({
  name: z.string().min(1),
  /** A LogQL stream selector identifying this project's app logs in Loki. */
  lokiSelector: z.string().min(1),
  /** Technology tag, e.g. "cakephp" — drives the memory seam and fixer context. */
  tech: z.string().min(1).optional(),
  /** Git remote (owner/name or URL). Presence makes the project fix-eligible. */
  repo: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
  /** Server path prefix (from stack traces) stripped to reach the repo root. */
  pathPrefix: z.string().min(1).optional(),
})
export type Project = z.infer<typeof ProjectSchema>

export type FixTarget = Project & { repo: string }
export function fixEligible(p: Project): p is FixTarget {
  return typeof p.repo === 'string' && p.repo.length > 0
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- fix-config`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/config/projects.ts apps/wgr-logs-medic/tests/fix-config.test.ts
git commit -m "feat(medic): per-project fix-config (tech, repo, defaultBranch, pathPrefix)"
```

---

## Task 3: Medic — project-agnostic `patternHash` + scanner wiring

**Files:**
- Modify: `apps/wgr-logs-medic/src/types.ts`
- Modify: `apps/wgr-logs-medic/src/scan/signature.ts`
- Modify: `apps/wgr-logs-medic/src/scan/scanner.ts`
- Test: `apps/wgr-logs-medic/tests/pattern-hash.test.ts`

**Interfaces:**
- Produces: `ParsedError.patternHash: string`; `ProblemCandidate` gains `patternHash: string` and `tech?: string`. `groupCandidates(lines, tech?)` attaches `tech`. `runScan` passes each project's `tech` through.

- [ ] **Step 1: Extend types** in `apps/wgr-logs-medic/src/types.ts` — add to `ParsedError` (after `template`):

```typescript
  /** Project-agnostic hash (category + exceptionClass + templated message, NO file path) for cross-project matching. */
  patternHash: string
```

and to `ProblemCandidate` (after `signature`):

```typescript
  patternHash: string
  tech?: string
```

- [ ] **Step 2: Write the failing test** `apps/wgr-logs-medic/tests/pattern-hash.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseError } from '../src/scan/signature.js'

describe('patternHash', () => {
  it('matches the same error class+message across different project paths', () => {
    const a = parseError("2026-06-17 10:00:00 Notice: Trying to get property 'slug' of non-object in [/data01/sites/projA/x.ctp, line 13]")
    const b = parseError("2026-06-18 11:00:00 Notice: Trying to get property 'slug' of non-object in [/var/www/projB/y.ctp, line 99]")
    expect(a.patternHash).toBe(b.patternHash)
    // signature (project-local) still differs because the file path differs
    expect(a.signature).not.toBe(b.signature)
  })

  it('differs for different error messages', () => {
    const a = parseError('2026-06-17 10:00:00 Error: [App\\FooException] boom (/x/Foo.php:9)')
    const b = parseError('2026-06-17 10:00:00 Error: [App\\BarException] bang (/x/Bar.php:9)')
    expect(a.patternHash).not.toBe(b.patternHash)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- pattern-hash`
Expected: FAIL — `patternHash` undefined.

- [ ] **Step 4: Emit `patternHash`** in `apps/wgr-logs-medic/src/scan/signature.ts` — inside `parseError`, after the `signature` is computed, add the project-agnostic hash and include it in the return:

```typescript
  const patternHash = createHash('sha256')
    .update([category, exceptionClass ?? '', template].join('\n'))
    .digest('hex')
    .slice(0, 16)

  return { signature, patternHash, category, exceptionClass, file, line: lineNo, template }
```

(`patternHash` deliberately omits `file` so the same error class+message matches across projects; `signature` keeps `file` and stays project-local.)

- [ ] **Step 5: Attach `patternHash` + `tech` in the scanner** — in `apps/wgr-logs-medic/src/scan/scanner.ts`, change `groupCandidates` to accept an optional `tech` and set both fields:

```typescript
export function groupCandidates(lines: readonly string[], tech?: string): ProblemCandidate[] {
  const bySig = new Map<string, ProblemCandidate>()
  for (const raw of lines) {
    const firstLine = raw.split('\n', 1)[0]
    const p = parseError(firstLine)
    const existing = bySig.get(p.signature)
    if (existing) {
      existing.count += 1
      continue
    }
    bySig.set(p.signature, {
      signature: p.signature,
      patternHash: p.patternHash,
      tech,
      category: p.category,
      file: p.file,
      line: p.line,
      sample: redact(firstLine),
      count: 1,
      fixabilityScore: scoreFixability(p).score,
    })
  }
  return [...bySig.values()].sort((a, b) => b.fixabilityScore - a.fixabilityScore || b.count - a.count)
}
```

and in `runScan`, pass the project's tech:

```typescript
    out.push({ project: project.name, candidates: groupCandidates(lines, project.tech) })
```

- [ ] **Step 6: Run to verify the pattern-hash test passes + the existing scanner test still passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- pattern-hash scanner`
Expected: PASS. (The existing `scanner.test.ts` calls `groupCandidates(lines)` with one arg — still valid since `tech` is optional.)

- [ ] **Step 7: Commit**

```bash
git add apps/wgr-logs-medic/src/types.ts apps/wgr-logs-medic/src/scan/signature.ts apps/wgr-logs-medic/src/scan/scanner.ts apps/wgr-logs-medic/tests/pattern-hash.test.ts
git commit -m "feat(medic): project-agnostic patternHash + tech on candidates (memory seam)"
```

---

## Task 4: Medic — server-path → repo-path mapping

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/path-map.ts`
- Test: `apps/wgr-logs-medic/tests/path-map.test.ts`

**Interfaces:**
- Produces: `mapServerPath(serverPath: string, pathPrefix?: string): string | null` — strips `pathPrefix` (and any leading `/`) to yield a repo-relative path; returns `null` if `serverPath` is empty or not under `pathPrefix`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/path-map.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { mapServerPath } from '../src/fix/path-map.js'

const PREFIX = '/data01/sites/prometerre/prod/prometerre.ch'

describe('mapServerPath', () => {
  it('strips the configured prefix to a repo-relative path', () => {
    expect(mapServerPath(`${PREFIX}/src/Template/Topics/view.ctp`, PREFIX)).toBe('src/Template/Topics/view.ctp')
  })

  it('tolerates a trailing slash on the prefix', () => {
    expect(mapServerPath(`${PREFIX}/src/x.php`, `${PREFIX}/`)).toBe('src/x.php')
  })

  it('returns null when the path is outside the prefix', () => {
    expect(mapServerPath('/usr/lib/php/other.php', PREFIX)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(mapServerPath('', PREFIX)).toBeNull()
    expect(mapServerPath(undefined as unknown as string, PREFIX)).toBeNull()
  })

  it('returns the path unchanged (minus leading slash) when no prefix is configured', () => {
    expect(mapServerPath('/src/x.php', undefined)).toBe('src/x.php')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- path-map`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/path-map.ts`**

```typescript
/** Map a stack-trace server path to a repo-relative path by stripping the project's pathPrefix. */
export function mapServerPath(serverPath: string, pathPrefix?: string): string | null {
  if (!serverPath) return null
  if (!pathPrefix) return serverPath.replace(/^\/+/, '') || null
  const prefix = pathPrefix.replace(/\/+$/, '')
  if (serverPath !== prefix && !serverPath.startsWith(`${prefix}/`)) return null
  return serverPath.slice(prefix.length).replace(/^\/+/, '') || null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- path-map`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/path-map.ts apps/wgr-logs-medic/tests/path-map.test.ts
git commit -m "feat(medic): server-path to repo-path mapping"
```

---

## Task 5: API — `tech` + `patternHash` on `problem` (+ medic post body)

**Files:**
- Modify: `apps/wgr-logs-api/src/problems/problem.entity.ts`
- Modify: `apps/wgr-logs-api/src/problems/dto/upsert-problem.dto.ts`
- Modify: `apps/wgr-logs-medic/src/api/problems.ts`
- Test: `apps/wgr-logs-medic/tests/problems.test.ts` (extend)

**Interfaces:**
- Consumes: `ProblemCandidate` now carries `patternHash` + `tech` (Task 3).
- Produces: the upsert body includes `tech` + `patternHash`; the `problems` table stores them.

- [ ] **Step 1: Extend the entity** — in `apps/wgr-logs-api/src/problems/problem.entity.ts`, add after the `category` column:

```typescript
  @Column({ type: 'text', nullable: true })
  tech!: string | null

  @Index()
  @Column({ name: 'pattern_hash', type: 'text', nullable: true })
  patternHash!: string | null
```

- [ ] **Step 2: Extend the DTO** — in `apps/wgr-logs-api/src/problems/dto/upsert-problem.dto.ts`, add (the global `ValidationPipe` has `forbidNonWhitelisted: true`, so the DTO MUST accept these since the client now sends them):

```typescript
  @IsOptional() @IsString() tech?: string
  @IsOptional() @IsString() patternHash?: string
```

- [ ] **Step 3: Persist them in the service** — in `apps/wgr-logs-api/src/problems/problems.service.ts`, in BOTH the update branch and the `create({...})` of `upsert`, add:

```typescript
      // update branch:
      existing.tech = dto.tech ?? null
      existing.patternHash = dto.patternHash ?? null
```
```typescript
      // create branch (inside problems.create({ ... })):
      tech: dto.tech ?? null,
      patternHash: dto.patternHash ?? null,
```

- [ ] **Step 4: Update the medic upsert body test** — in `apps/wgr-logs-medic/tests/problems.test.ts`, extend the `candidate` const and the body assertion:

```typescript
const candidate = { signature: 's1', patternHash: 'p1', tech: 'cakephp', category: 'Notice', file: '/x.ctp', line: 13, sample: 'x', count: 4, fixabilityScore: 0.9 }
```
and in the first test, after the existing `toMatchObject`:

```typescript
    expect(body).toMatchObject({ signature: 's1', patternHash: 'p1', tech: 'cakephp', count: 4 })
```

`postProblem` already serializes the whole candidate, so no source change is needed there — confirm by running the test.

- [ ] **Step 5: Run + build**

Run: `npm run test -w @wgr/wgr-logs-medic -- problems && npm run build -w @wgr/wgr-logs-api`
Expected: medic test PASS; `nest build` exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/wgr-logs-api/src/problems apps/wgr-logs-medic/tests/problems.test.ts
git commit -m "feat(api): tech + patternHash on problem (memory seam)"
```

---

## Task 6: API — `Remediation` + `ProjectContext` entities

**Files:**
- Create: `apps/wgr-logs-api/src/remediations/remediation.entity.ts`
- Create: `apps/wgr-logs-api/src/project-context/project-context.entity.ts`
- Modify: `apps/wgr-logs-api/src/config/database.config.ts`

**Interfaces:**
- Produces: `Remediation` (table `remediations`), `ProjectContext` (table `project_context`), both registered in TypeORM.

- [ ] **Step 1: Create `apps/wgr-logs-api/src/remediations/remediation.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, Index, ManyToOne, JoinColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { Problem } from '../problems/problem.entity'

export type RemediationStatus = 'open' | 'fixing' | 'pr_open' | 'needs_input' | 'changes_requested' | 'merged' | 'wontfix'

@Entity('remediations')
export class Remediation {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'problem_id', type: 'int' })
  problemId!: number

  @ManyToOne(() => Problem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem!: Problem

  @Column({ type: 'text' })
  repo!: string

  @Column({ type: 'text', nullable: true })
  branch!: string | null

  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl!: string | null

  @Column({ name: 'pr_number', type: 'int', nullable: true })
  prNumber!: number | null

  @Column({ name: 'session_id', type: 'text', nullable: true })
  sessionId!: string | null

  @Column({ type: 'text', default: 'open' })
  status!: RemediationStatus

  @Column({ name: 'cost_usd', type: 'float', default: 0 })
  costUsd!: number

  @Column({ type: 'text', nullable: true })
  summary!: string | null

  @Column({ name: 'diff_stat', type: 'text', nullable: true })
  diffStat!: string | null

  @Column({ name: 'not_verified', type: 'text', nullable: true })
  notVerified!: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
```

- [ ] **Step 2: Create `apps/wgr-logs-api/src/project-context/project-context.entity.ts`**

```typescript
import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

@Entity('project_context')
@Unique(['repo'])
export class ProjectContext {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'text' })
  repo!: string

  @Column({ type: 'text', nullable: true })
  tech!: string | null

  @Column({ type: 'text' })
  summary!: string

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
```

- [ ] **Step 3: Register both** — in `apps/wgr-logs-api/src/config/database.config.ts`, add imports and extend the entities array:

```typescript
import { Remediation } from '../remediations/remediation.entity'
import { ProjectContext } from '../project-context/project-context.entity'
// ...
  entities: [Agent, Source, ConfigVersion, Problem, Remediation, ProjectContext],
```

- [ ] **Step 4: Build**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-api/src/remediations/remediation.entity.ts apps/wgr-logs-api/src/project-context/project-context.entity.ts apps/wgr-logs-api/src/config/database.config.ts
git commit -m "feat(api): Remediation + ProjectContext entities"
```

---

## Task 7: API — `remediations` module

**Files:**
- Create: `apps/wgr-logs-api/src/remediations/dto/create-remediation.dto.ts`
- Create: `apps/wgr-logs-api/src/remediations/dto/update-remediation.dto.ts`
- Create: `apps/wgr-logs-api/src/remediations/remediations.service.ts`
- Create: `apps/wgr-logs-api/src/remediations/remediations.controller.ts`
- Create: `apps/wgr-logs-api/src/remediations/remediations.module.ts`
- Modify: `apps/wgr-logs-api/src/app.module.ts`

**Interfaces:**
- Produces: `POST/GET /mgmt/projects/:project/remediations`, `PATCH /mgmt/remediations/:id` (admin-guarded).

- [ ] **Step 1: Create `dto/create-remediation.dto.ts`**

```typescript
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class CreateRemediationDto {
  @IsInt() problemId!: number
  @IsString() repo!: string
  @IsOptional() @IsString() branch?: string
  @IsOptional() @IsString() prUrl?: string
  @IsOptional() @IsInt() prNumber?: number
  @IsOptional() @IsString() sessionId?: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsNumber() @Min(0) costUsd?: number
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() diffStat?: string
  @IsOptional() @IsString() notVerified?: string
}
```

- [ ] **Step 2: Create `dto/update-remediation.dto.ts`**

```typescript
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class UpdateRemediationDto {
  @IsOptional() @IsString() branch?: string
  @IsOptional() @IsString() prUrl?: string
  @IsOptional() @IsInt() prNumber?: number
  @IsOptional() @IsString() sessionId?: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsNumber() @Min(0) costUsd?: number
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() diffStat?: string
  @IsOptional() @IsString() notVerified?: string
}
```

- [ ] **Step 3: Create `remediations.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Remediation, type RemediationStatus } from './remediation.entity'
import { CreateRemediationDto } from './dto/create-remediation.dto'
import { UpdateRemediationDto } from './dto/update-remediation.dto'

@Injectable()
export class RemediationsService {
  constructor(
    @InjectRepository(Remediation)
    private readonly remediations: Repository<Remediation>,
  ) {}

  list(project: string): Promise<Remediation[]> {
    return this.remediations.find({
      where: { problem: { project } },
      relations: { problem: true },
      order: { updatedAt: 'DESC', id: 'DESC' },
    })
  }

  create(dto: CreateRemediationDto): Promise<Remediation> {
    const created = this.remediations.create({
      problemId: dto.problemId,
      repo: dto.repo,
      branch: dto.branch ?? null,
      prUrl: dto.prUrl ?? null,
      prNumber: dto.prNumber ?? null,
      sessionId: dto.sessionId ?? null,
      status: (dto.status as RemediationStatus | undefined) ?? 'open',
      costUsd: dto.costUsd ?? 0,
      summary: dto.summary ?? null,
      diffStat: dto.diffStat ?? null,
      notVerified: dto.notVerified ?? null,
    })
    return this.remediations.save(created)
  }

  async update(id: number, dto: UpdateRemediationDto): Promise<Remediation> {
    const existing = await this.remediations.findOne({ where: { id } })
    if (!existing) throw new NotFoundException(`remediation ${id} not found`)
    if (dto.branch !== undefined) existing.branch = dto.branch
    if (dto.prUrl !== undefined) existing.prUrl = dto.prUrl
    if (dto.prNumber !== undefined) existing.prNumber = dto.prNumber
    if (dto.sessionId !== undefined) existing.sessionId = dto.sessionId
    if (dto.status !== undefined) existing.status = dto.status as RemediationStatus
    if (dto.costUsd !== undefined) existing.costUsd = dto.costUsd
    if (dto.summary !== undefined) existing.summary = dto.summary
    if (dto.diffStat !== undefined) existing.diffStat = dto.diffStat
    if (dto.notVerified !== undefined) existing.notVerified = dto.notVerified
    return this.remediations.save(existing)
  }
}
```

- [ ] **Step 4: Create `remediations.controller.ts`**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { RemediationsService } from './remediations.service'
import { CreateRemediationDto } from './dto/create-remediation.dto'
import { UpdateRemediationDto } from './dto/update-remediation.dto'

@Controller()
@UseGuards(AdminGuard)
export class RemediationsController {
  constructor(private readonly service: RemediationsService) {}

  @Get('projects/:project/remediations')
  list(@Param('project') project: string) {
    return this.service.list(project)
  }

  @Post('projects/:project/remediations')
  create(@Body() dto: CreateRemediationDto) {
    return this.service.create(dto)
  }

  @Patch('remediations/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRemediationDto) {
    return this.service.update(id, dto)
  }
}
```

- [ ] **Step 5: Create `remediations.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Remediation } from './remediation.entity'
import { RemediationsService } from './remediations.service'
import { RemediationsController } from './remediations.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Remediation]), AuthModule],
  providers: [RemediationsService],
  controllers: [RemediationsController],
})
export class RemediationsModule {}
```

- [ ] **Step 6: Wire into `app.module.ts`** — add the import and `RemediationsModule` to the `imports` array (after `ProblemsModule`).

- [ ] **Step 7: Build**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/wgr-logs-api/src/remediations apps/wgr-logs-api/src/app.module.ts
git commit -m "feat(api): /mgmt remediations (create + list + patch)"
```

---

## Task 8: API — `project-context` module

**Files:**
- Create: `apps/wgr-logs-api/src/project-context/dto/upsert-project-context.dto.ts`
- Create: `apps/wgr-logs-api/src/project-context/project-context.service.ts`
- Create: `apps/wgr-logs-api/src/project-context/project-context.controller.ts`
- Create: `apps/wgr-logs-api/src/project-context/project-context.module.ts`
- Modify: `apps/wgr-logs-api/src/app.module.ts`

**Interfaces:**
- Produces: `GET /mgmt/project-context/:repo`, `PUT /mgmt/project-context/:repo` (admin-guarded). `:repo` is URL-encoded by the client.

- [ ] **Step 1: Create `dto/upsert-project-context.dto.ts`**

```typescript
import { IsOptional, IsString } from 'class-validator'

export class UpsertProjectContextDto {
  @IsOptional() @IsString() tech?: string
  @IsString() summary!: string
}
```

- [ ] **Step 2: Create `project-context.service.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ProjectContext } from './project-context.entity'
import { UpsertProjectContextDto } from './dto/upsert-project-context.dto'

@Injectable()
export class ProjectContextService {
  constructor(
    @InjectRepository(ProjectContext)
    private readonly contexts: Repository<ProjectContext>,
  ) {}

  get(repo: string): Promise<ProjectContext | null> {
    return this.contexts.findOne({ where: { repo } })
  }

  async upsert(repo: string, dto: UpsertProjectContextDto): Promise<ProjectContext> {
    const existing = await this.contexts.findOne({ where: { repo } })
    if (existing) {
      existing.tech = dto.tech ?? null
      existing.summary = dto.summary
      return this.contexts.save(existing)
    }
    return this.contexts.save(this.contexts.create({ repo, tech: dto.tech ?? null, summary: dto.summary }))
  }
}
```

- [ ] **Step 3: Create `project-context.controller.ts`** (the `:repo` param is URL-encoded; Nest decodes it automatically)

```typescript
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { ProjectContextService } from './project-context.service'
import { UpsertProjectContextDto } from './dto/upsert-project-context.dto'

@Controller('project-context')
@UseGuards(AdminGuard)
export class ProjectContextController {
  constructor(private readonly service: ProjectContextService) {}

  @Get(':repo')
  get(@Param('repo') repo: string) {
    return this.service.get(repo)
  }

  @Put(':repo')
  upsert(@Param('repo') repo: string, @Body() dto: UpsertProjectContextDto) {
    return this.service.upsert(repo, dto)
  }
}
```

- [ ] **Step 4: Create `project-context.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { ProjectContext } from './project-context.entity'
import { ProjectContextService } from './project-context.service'
import { ProjectContextController } from './project-context.controller'

@Module({
  imports: [TypeOrmModule.forFeature([ProjectContext]), AuthModule],
  providers: [ProjectContextService],
  controllers: [ProjectContextController],
})
export class ProjectContextModule {}
```

- [ ] **Step 5: Wire into `app.module.ts`** — add the import and `ProjectContextModule` to the `imports` array.

- [ ] **Step 6: Build**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/wgr-logs-api/src/project-context apps/wgr-logs-api/src/app.module.ts
git commit -m "feat(api): /mgmt project-context (get + upsert)"
```

---

## Task 9: Medic — API clients (remediations, project-context, getProblem)

**Files:**
- Create: `apps/wgr-logs-medic/src/api/remediations.ts`
- Create: `apps/wgr-logs-medic/src/api/context.ts`
- Modify: `apps/wgr-logs-medic/src/api/problems.ts` (add `getProblem`)
- Modify: `apps/wgr-logs-medic/src/types.ts` (add `Problem`, `Remediation` shapes)
- Test: `apps/wgr-logs-medic/tests/remediations-client.test.ts`

**Interfaces:**
- Produces: `getProblem(cfg, project, id, fetch?) → Problem`; `createRemediation(cfg, project, body, fetch?) → Remediation`; `updateRemediation(cfg, id, patch, fetch?) → Remediation`; `getProjectContext(cfg, repo, fetch?) → ProjectContext | null`; `putProjectContext(cfg, repo, body, fetch?) → ProjectContext`.

- [ ] **Step 1: Add shared shapes** in `apps/wgr-logs-medic/src/types.ts`:

```typescript
export interface Problem {
  id: number
  project: string
  signature: string
  patternHash: string | null
  tech: string | null
  category: string
  file: string | null
  line: number | null
  sample: string
  count: number
  fixabilityScore: number
  status: string
}

export type RemediationStatus = 'open' | 'fixing' | 'pr_open' | 'needs_input' | 'changes_requested' | 'merged' | 'wontfix'

export interface Remediation {
  id: number
  problemId: number
  repo: string
  branch: string | null
  prUrl: string | null
  prNumber: number | null
  sessionId: string | null
  status: RemediationStatus
  costUsd: number
  summary: string | null
  diffStat: string | null
  notVerified: string | null
}

export interface ProjectContext {
  id: number
  repo: string
  tech: string | null
  summary: string
}
```

- [ ] **Step 2: Write the failing test** `apps/wgr-logs-medic/tests/remediations-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { createRemediation, updateRemediation } from '../src/api/remediations.js'
import { getProjectContext, putProjectContext } from '../src/api/context.js'

function recordingFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const cfg = { url: 'https://logs.example/mgmt', adminToken: 'ADMIN' }

describe('remediations client', () => {
  it('POSTs a remediation with Bearer auth to the project route', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":7}', { status: 201 }))
    const r = await createRemediation(cfg, 'prometerre', { problemId: 3, repo: 'github.com/wgr-sa/p' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/projects/prometerre/remediations')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer ADMIN')
    expect(r.id).toBe(7)
  })

  it('PATCHes a remediation by id', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":7}', { status: 200 }))
    await updateRemediation(cfg, 7, { status: 'pr_open' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/remediations/7')
    expect(calls[0].init?.method).toBe('PATCH')
  })

  it('throws on non-2xx', async () => {
    const { fetchImpl } = recordingFetch(new Response('no', { status: 401 }))
    await expect(createRemediation(cfg, 'p', { problemId: 1, repo: 'r' }, fetchImpl)).rejects.toThrow()
  })
})

describe('project-context client', () => {
  it('GET returns null on 404', async () => {
    const { fetchImpl } = recordingFetch(new Response('', { status: 404 }))
    expect(await getProjectContext(cfg, 'github.com/wgr-sa/p', fetchImpl)).toBeNull()
  })

  it('PUT url-encodes the repo', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{"id":1,"repo":"github.com/wgr-sa/p","tech":null,"summary":"s"}', { status: 200 }))
    await putProjectContext(cfg, 'github.com/wgr-sa/p', { summary: 's' }, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/project-context/github.com%2Fwgr-sa%2Fp')
    expect(calls[0].init?.method).toBe('PUT')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- remediations-client`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `apps/wgr-logs-medic/src/api/remediations.ts`**

```typescript
import type { ApiConfig } from '../config/env.js'
import type { Remediation } from '../types.js'

function authHeaders(cfg: ApiConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.adminToken}` }
}

export interface CreateRemediationBody {
  problemId: number
  repo: string
  branch?: string
  prUrl?: string
  prNumber?: number
  sessionId?: string
  status?: string
  costUsd?: number
  summary?: string
  diffStat?: string
  notVerified?: string
}

export async function createRemediation(
  cfg: ApiConfig,
  project: string,
  body: CreateRemediationBody,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation> {
  const res = await fetchImpl(`${cfg.url}/projects/${encodeURIComponent(project)}/remediations`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`create remediation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation
}

export async function updateRemediation(
  cfg: ApiConfig,
  id: number,
  patch: Partial<CreateRemediationBody>,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation> {
  const res = await fetchImpl(`${cfg.url}/remediations/${id}`, {
    method: 'PATCH',
    headers: authHeaders(cfg),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update remediation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation
}

export async function listRemediations(
  cfg: ApiConfig,
  project: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation[]> {
  const res = await fetchImpl(`${cfg.url}/projects/${encodeURIComponent(project)}/remediations`, {
    headers: authHeaders(cfg),
  })
  if (!res.ok) throw new Error(`list remediations failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation[]
}
```

- [ ] **Step 5: Implement `apps/wgr-logs-medic/src/api/context.ts`**

```typescript
import type { ApiConfig } from '../config/env.js'
import type { ProjectContext } from '../types.js'

function authHeaders(cfg: ApiConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.adminToken}` }
}

export async function getProjectContext(
  cfg: ApiConfig,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectContext | null> {
  const res = await fetchImpl(`${cfg.url}/project-context/${encodeURIComponent(repo)}`, {
    headers: authHeaders(cfg),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get project-context failed: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? (JSON.parse(text) as ProjectContext) : null
}

export async function putProjectContext(
  cfg: ApiConfig,
  repo: string,
  body: { tech?: string; summary: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectContext> {
  const res = await fetchImpl(`${cfg.url}/project-context/${encodeURIComponent(repo)}`, {
    method: 'PUT',
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`put project-context failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as ProjectContext
}
```

- [ ] **Step 6: Add `getProblem`** to `apps/wgr-logs-medic/src/api/problems.ts`:

```typescript
import type { Problem } from '../types.js'
// ...
export async function getProblem(
  config: ApiConfig,
  project: string,
  id: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Problem> {
  const res = await fetchImpl(`${config.url}/projects/${encodeURIComponent(project)}/problems`, {
    headers: { Authorization: `Bearer ${config.adminToken}` },
  })
  if (!res.ok) throw new Error(`GET problems failed: ${res.status} ${await res.text()}`)
  const problems = (await res.json()) as Problem[]
  const found = problems.find((p) => p.id === id)
  if (!found) throw new Error(`problem ${id} not found in project ${project}`)
  return found
}
```

(The Phase 1 list endpoint returns all problems for a project; `getProblem` filters by id — no new API route needed.)

- [ ] **Step 7: Run + typecheck + lint**

Run: `npm run test -w @wgr/wgr-logs-medic -- remediations-client && npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic`
Expected: PASS (5 tests); typecheck + lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/wgr-logs-medic/src/api apps/wgr-logs-medic/src/types.ts apps/wgr-logs-medic/tests/remediations-client.test.ts
git commit -m "feat(medic): API clients for remediations + project-context + getProblem"
```

---

## Task 10: Medic — git/gh command layer

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/git.ts`
- Test: `apps/wgr-logs-medic/tests/git.test.ts`

The git/gh layer separates *deterministic argument construction* (pure, tested) from *running the subprocess* (an injected `Runner`). This keeps the outward step auditable and testable without a network.

**Interfaces:**
- Produces: `Runner = (cmd, args, opts) => Promise<{ stdout, stderr, code }>`; `cloneUrl(repo, token)`; `branchName(signature, now)`; `prCreateArgs({title, body, base, head})`; class `Git` wrapping a repo dir + runner with `clone/checkoutNewBranch/add/commit/push` and `Gh` with `prCreate/prComments`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/git.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { cloneUrl, branchName, prCreateArgs } from '../src/fix/git.js'

describe('cloneUrl', () => {
  it('injects an x-access-token into an owner/name repo', () => {
    expect(cloneUrl('github.com/wgr-sa/prometerre', 'TKN')).toBe('https://x-access-token:TKN@github.com/wgr-sa/prometerre.git')
  })
  it('normalizes a full https URL and a .git suffix', () => {
    expect(cloneUrl('https://github.com/wgr-sa/prometerre.git', 'TKN')).toBe('https://x-access-token:TKN@github.com/wgr-sa/prometerre.git')
  })
})

describe('branchName', () => {
  it('is deterministic and signature-scoped', () => {
    expect(branchName('abcd1234', 1_700_000_000_000)).toBe('medic/fix-abcd1234-1700000000000')
  })
})

describe('prCreateArgs', () => {
  it('builds gh pr create args with title/body/base/head', () => {
    const args = prCreateArgs({ title: 'T', body: 'B', base: 'main', head: 'medic/x' })
    expect(args).toEqual(['pr', 'create', '--title', 'T', '--body', 'B', '--base', 'main', '--head', 'medic/x'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- git`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/git.ts`**

```typescript
import { spawn } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}
export type Runner = (cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<RunResult>

export const execRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, env: opts?.env ?? process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
  })

/** Build an authenticated https clone URL from `owner/name`, `github.com/owner/name`, or a full URL. */
export function cloneUrl(repo: string, token: string): string {
  const path = repo
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
  return `https://x-access-token:${token}@github.com/${path}.git`
}

export function branchName(signature: string, now: number): string {
  return `medic/fix-${signature}-${now}`
}

export function prCreateArgs(o: { title: string; body: string; base: string; head: string }): string[] {
  return ['pr', 'create', '--title', o.title, '--body', o.body, '--base', o.base, '--head', o.head]
}

export class Git {
  constructor(
    private readonly dir: string,
    private readonly run: Runner = execRunner,
  ) {}

  private async git(args: string[]): Promise<RunResult> {
    const res = await this.run('git', args, { cwd: this.dir })
    if (res.code !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr.trim()}`)
    return res
  }

  checkoutNewBranch(branch: string): Promise<RunResult> {
    return this.git(['checkout', '-b', branch])
  }
  addAll(): Promise<RunResult> {
    return this.git(['add', '-A'])
  }
  commit(message: string): Promise<RunResult> {
    return this.git(['commit', '-m', message])
  }
  push(branch: string): Promise<RunResult> {
    return this.git(['push', '-u', 'origin', branch])
  }
  async diffStat(base: string): Promise<string> {
    const res = await this.git(['diff', '--stat', `${base}...HEAD`])
    return res.stdout.trim()
  }
}

export class Gh {
  constructor(
    private readonly dir: string,
    private readonly token: string,
    private readonly run: Runner = execRunner,
  ) {}

  private gh(args: string[]): Promise<RunResult> {
    return this.run('gh', args, { cwd: this.dir, env: { ...process.env, GH_TOKEN: this.token } })
  }

  async prCreate(o: { title: string; body: string; base: string; head: string }): Promise<string> {
    const res = await this.gh(prCreateArgs(o))
    if (res.code !== 0) throw new Error(`gh pr create failed: ${res.stderr.trim()}`)
    return res.stdout.trim() // PR URL
  }

  async prComments(pr: string): Promise<string> {
    const res = await this.gh(['pr', 'view', pr, '--comments'])
    if (res.code !== 0) throw new Error(`gh pr view failed: ${res.stderr.trim()}`)
    return res.stdout
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- git`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/git.ts apps/wgr-logs-medic/tests/git.test.ts
git commit -m "feat(medic): git/gh command layer (pure arg-building + injected runner)"
```

---

## Task 11: Medic — throwaway clone + tiered verification

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/clone.ts`
- Create: `apps/wgr-logs-medic/src/fix/verify.ts`
- Test: `apps/wgr-logs-medic/tests/verify.test.ts`

**Interfaces:**
- Produces: `withClone(repo, token, run, fn)` clones to a temp dir, runs `fn(dir)`, always cleans up. `planChecks(changedFiles, dirHas)` (pure) → ordered list of `{ cmd, args }` checks (php -l per changed .php; phpunit if `phpunit.xml*` present; phpstan if `phpstan.neon*`). `verify(dir, changedFiles, run)` runs them best-effort → `{ ran, ok, notVerified }`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/verify.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { planChecks } from '../src/fix/verify.js'

describe('planChecks', () => {
  it('lints each changed PHP file with php -l', () => {
    const plan = planChecks(['src/a.php', 'src/b.php', 'README.md'], () => false)
    expect(plan.filter((c) => c.cmd === 'php')).toEqual([
      { cmd: 'php', args: ['-l', 'src/a.php'] },
      { cmd: 'php', args: ['-l', 'src/b.php'] },
    ])
  })

  it('adds phpstan when configured', () => {
    const plan = planChecks(['src/a.php'], (f) => f === 'phpstan.neon')
    expect(plan.some((c) => c.cmd === 'vendor/bin/phpstan')).toBe(true)
  })

  it('adds phpunit when configured', () => {
    const plan = planChecks(['src/a.php'], (f) => f === 'phpunit.xml')
    expect(plan.some((c) => c.cmd === 'vendor/bin/phpunit')).toBe(true)
  })

  it('no PHP files -> no php -l checks', () => {
    expect(planChecks(['README.md'], () => false).filter((c) => c.cmd === 'php')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- verify`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/verify.ts`**

```typescript
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Runner } from './git.js'

export interface Check {
  cmd: string
  args: string[]
}

/** Pure: decide which best-effort checks to run for the changed files. `dirHas(rel)` = file exists at repo root. */
export function planChecks(changedFiles: readonly string[], dirHas: (rel: string) => boolean): Check[] {
  const checks: Check[] = []
  for (const f of changedFiles) {
    if (f.endsWith('.php')) checks.push({ cmd: 'php', args: ['-l', f] })
  }
  if (dirHas('phpstan.neon') || dirHas('phpstan.neon.dist')) {
    checks.push({ cmd: 'vendor/bin/phpstan', args: ['analyse', '--no-progress'] })
  }
  if (dirHas('phpunit.xml') || dirHas('phpunit.xml.dist')) {
    checks.push({ cmd: 'vendor/bin/phpunit', args: ['--no-coverage'] })
  }
  return checks
}

export interface VerifyResult {
  ran: string[]
  ok: boolean
  notVerified: string | null
}

/** Best-effort: run each planned check; a missing tool (non-zero exit) is recorded, not fatal. */
export async function verify(dir: string, changedFiles: readonly string[], run: Runner): Promise<VerifyResult> {
  const plan = planChecks(changedFiles, (rel) => existsSync(join(dir, rel)))
  const ran: string[] = []
  const failures: string[] = []
  for (const c of plan) {
    const res = await run(c.cmd, c.args, { cwd: dir })
    ran.push(`${c.cmd} ${c.args.join(' ')}`)
    if (res.code !== 0) failures.push(`${c.cmd} (${res.stderr.trim().slice(0, 200)})`)
  }
  const notVerified = plan.length === 0 ? 'no automated checks available for this repo' : failures.length ? `checks failed/unavailable: ${failures.join('; ')}` : null
  return { ran, ok: failures.length === 0, notVerified }
}
```

- [ ] **Step 4: Implement `apps/wgr-logs-medic/src/fix/clone.ts`**

```typescript
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneUrl, type Runner, execRunner } from './git.js'

/** Shallow-clone `repo` into a throwaway temp dir, run `fn(dir)`, always clean up. */
export async function withClone<T>(
  repo: string,
  token: string,
  fn: (dir: string) => Promise<T>,
  run: Runner = execRunner,
  branch?: string,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'wgr-medic-'))
  try {
    const args = ['clone', '--depth', '1']
    if (branch) args.push('--branch', branch)
    args.push(cloneUrl(repo, token), dir)
    const res = await run('git', args)
    if (res.code !== 0) throw new Error(`clone failed: ${res.stderr.trim()}`)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 5: Run + typecheck**

Run: `npm run test -w @wgr/wgr-logs-medic -- verify && npm run typecheck -w @wgr/wgr-logs-medic`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/clone.ts apps/wgr-logs-medic/src/fix/verify.ts apps/wgr-logs-medic/tests/verify.test.ts
git commit -m "feat(medic): throwaway clone + tiered best-effort verification"
```

---

## Task 12: Medic — per-project context (generate + cache)

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/context.ts`
- Test: `apps/wgr-logs-medic/tests/context.test.ts`

**Interfaces:**
- Produces: `ensureProjectContext(deps) → string` — returns the cached `summary` if the API already has one for the repo OR the clone already has a `CLAUDE.md`; otherwise calls the injected `generate()`, persists via `putProjectContext`, writes `CLAUDE.md` into the clone, and returns it. Deps are injected (`getCtx`, `putCtx`, `generate`, `readClaudeMd`, `writeClaudeMd`) so the cache logic is unit-tested without SDK/network.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/context.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { ensureProjectContext, type EnsureContextDeps } from '../src/fix/context.js'

const base = (over: Partial<EnsureContextDeps>): EnsureContextDeps => ({
  repo: 'github.com/wgr-sa/p',
  tech: 'cakephp',
  dir: '/tmp/clone',
  getCtx: async () => null,
  putCtx: async (_repo, body) => ({ id: 1, repo: 'github.com/wgr-sa/p', tech: 'cakephp', summary: body.summary }),
  generate: async () => 'GENERATED',
  readClaudeMd: () => null,
  writeClaudeMd: vi.fn(),
  ...over,
})

describe('ensureProjectContext', () => {
  it('reuses the cached API summary and does not generate', async () => {
    const generate = vi.fn(async () => 'GENERATED')
    const out = await ensureProjectContext(base({ getCtx: async () => ({ id: 1, repo: 'r', tech: 't', summary: 'CACHED' }), generate }))
    expect(out).toBe('CACHED')
    expect(generate).not.toHaveBeenCalled()
  })

  it('reuses an existing CLAUDE.md in the clone', async () => {
    const generate = vi.fn(async () => 'GENERATED')
    const out = await ensureProjectContext(base({ readClaudeMd: () => 'REPO_CLAUDE', generate }))
    expect(out).toBe('REPO_CLAUDE')
    expect(generate).not.toHaveBeenCalled()
  })

  it('generates, persists and writes CLAUDE.md when nothing is cached', async () => {
    const writeClaudeMd = vi.fn()
    const putCtx = vi.fn(async (_r: string, b: { summary: string }) => ({ id: 1, repo: 'r', tech: null, summary: b.summary }))
    const out = await ensureProjectContext(base({ writeClaudeMd, putCtx }))
    expect(out).toBe('GENERATED')
    expect(writeClaudeMd).toHaveBeenCalledWith('GENERATED')
    expect(putCtx).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- context`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/context.ts`**

```typescript
import type { ProjectContext } from '../types.js'

export interface EnsureContextDeps {
  repo: string
  tech?: string
  dir: string
  getCtx: (repo: string) => Promise<ProjectContext | null>
  putCtx: (repo: string, body: { tech?: string; summary: string }) => Promise<ProjectContext>
  generate: (dir: string) => Promise<string>
  readClaudeMd: (dir: string) => string | null
  writeClaudeMd: (summary: string) => void
}

/** Return per-project codebase understanding, generating + caching it once if absent. */
export async function ensureProjectContext(deps: EnsureContextDeps): Promise<string> {
  const cached = await deps.getCtx(deps.repo)
  if (cached?.summary) return cached.summary

  const existing = deps.readClaudeMd(deps.dir)
  if (existing) return existing

  const summary = await deps.generate(deps.dir)
  deps.writeClaudeMd(summary)
  await deps.putCtx(deps.repo, { tech: deps.tech, summary })
  return summary
}
```

(The concrete `generate`, `readClaudeMd`, `writeClaudeMd` wirings — a read-only one-shot `query()` and `fs` calls — are assembled in Task 13/15; this unit owns only the cache decision.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- context`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/context.ts apps/wgr-logs-medic/tests/context.test.ts
git commit -m "feat(medic): per-project context cache decision (generate-once)"
```

---

## Task 13: Medic — the fixer (inner SDK query → FixResult)

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/fixer.ts`
- Test: `apps/wgr-logs-medic/tests/fixer.test.ts`

The non-deterministic `query()` is wrapped behind an injected `runQuery`; the unit tests cover the deterministic pieces (prompt building + result parsing).

**Interfaces:**
- Consumes: `Problem` (types), repo-relative path (Task 4), project context (Task 12).
- Produces: `buildFixPrompt(input)` (pure) and `parseFixResult(raw)` (pure) and `runFixer(input, runQuery)` → `FixResult { prTitle, prBody, summary, notVerified, sessionId, costUsd, changedFiles }`. The fixer instructs the agent to end with a single fenced ```json block carrying `{prTitle, prBody, summary, changedFiles}`.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/fixer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildFixPrompt, parseFixResult } from '../src/fix/fixer.js'

describe('buildFixPrompt', () => {
  it('includes the repo path, category and redacted sample, and forbids pushing', () => {
    const p = buildFixPrompt({
      repoPath: 'src/Template/Topics/view.ctp',
      category: 'Notice',
      sample: "Trying to get property 'slug' of non-object",
      context: 'CakePHP app',
    })
    expect(p).toContain('src/Template/Topics/view.ctp')
    expect(p).toContain('Notice')
    expect(p).toContain("Trying to get property 'slug'")
    expect(p.toLowerCase()).toContain('do not push')
    expect(p).toContain('```json')
  })
})

describe('parseFixResult', () => {
  it('extracts the trailing json block', () => {
    const raw = 'I fixed it.\n```json\n{"prTitle":"Fix null guard","prBody":"body","summary":"added guard","changedFiles":["src/x.ctp"]}\n```\n'
    const r = parseFixResult(raw)
    expect(r.prTitle).toBe('Fix null guard')
    expect(r.changedFiles).toEqual(['src/x.ctp'])
  })

  it('throws when no json block is present', () => {
    expect(() => parseFixResult('no json here')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- fixer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/fixer.ts`**

```typescript
export interface FixPromptInput {
  repoPath: string
  category: string
  sample: string
  context: string
}

export function buildFixPrompt(input: FixPromptInput): string {
  return [
    `A recurring application error was triaged from production logs.`,
    `Category: ${input.category}`,
    `Likely file (repo-relative): ${input.repoPath}`,
    `Redacted log sample:`,
    input.sample,
    ``,
    `Project context:`,
    input.context,
    ``,
    `Your task: locate the root cause near that file, make the smallest correct fix, and verify it as best you can with the repo's own tooling.`,
    `Constraints: edit only what is necessary. DO NOT push, DO NOT open a pull request, DO NOT run git push or gh — that is handled outside. Work only in this clone.`,
    `When done, end your final message with a single fenced json block:`,
    '```json',
    `{"prTitle": "<concise PR title>", "prBody": "<what changed and why, and what was NOT verified>", "summary": "<one line>", "changedFiles": ["<repo-relative path>", "..."]}`,
    '```',
  ].join('\n')
}

export interface FixResult {
  prTitle: string
  prBody: string
  summary: string
  changedFiles: string[]
  notVerified: string | null
  sessionId: string | null
  costUsd: number
}

interface RawFix {
  prTitle: string
  prBody: string
  summary: string
  changedFiles: string[]
}

/** Extract the trailing fenced json block the fixer is instructed to emit. */
export function parseFixResult(raw: string): RawFix {
  const matches = [...raw.matchAll(/```json\s*([\s\S]*?)```/g)]
  if (matches.length === 0) throw new Error('fixer produced no json result block')
  const json = matches[matches.length - 1][1].trim()
  const parsed = JSON.parse(json) as RawFix
  if (!parsed.prTitle || !Array.isArray(parsed.changedFiles)) throw new Error('fixer json missing required fields')
  return parsed
}

export interface QueryOutcome {
  resultText: string
  sessionId: string | null
  costUsd: number
  success: boolean
}
export type RunQuery = (prompt: string, cwd: string) => Promise<QueryOutcome>

export interface FixerInput {
  prompt: string
  cwd: string
}

export async function runFixer(input: FixerInput, runQuery: RunQuery): Promise<FixResult> {
  const outcome = await runQuery(input.prompt, input.cwd)
  if (!outcome.success) throw new Error('fixer session did not complete successfully')
  const raw = parseFixResult(outcome.resultText)
  return {
    prTitle: raw.prTitle,
    prBody: raw.prBody,
    summary: raw.summary,
    changedFiles: raw.changedFiles,
    notVerified: null,
    sessionId: outcome.sessionId,
    costUsd: outcome.costUsd,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- fixer`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/fixer.ts apps/wgr-logs-medic/tests/fixer.test.ts
git commit -m "feat(medic): fixer prompt builder + result parser (SDK behind injected runQuery)"
```

---

## Task 14: Medic — publish (deterministic outward step)

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/publish.ts`
- Test: `apps/wgr-logs-medic/tests/publish.test.ts`

**Interfaces:**
- Consumes: `redact` (Task scan/redact), `Git`/`Gh` (Task 10), `FixResult` (Task 13).
- Produces: `publish(opts) → { prUrl, branch, diffStat }`. Redacts the PR body, creates+commits+pushes the branch, opens the PR via `gh`. The fixer never does this.

- [ ] **Step 1: Write the failing test** `apps/wgr-logs-medic/tests/publish.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { publish } from '../src/fix/publish.js'
import type { Runner } from '../src/fix/git.js'

function recordingRunner(prUrl: string) {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const run: Runner = async (cmd, args) => {
    calls.push({ cmd, args })
    if (cmd === 'gh' && args[0] === 'pr') return { stdout: prUrl, stderr: '', code: 0 }
    if (cmd === 'git' && args[0] === 'diff') return { stdout: ' 1 file changed', stderr: '', code: 0 }
    return { stdout: '', stderr: '', code: 0 }
  }
  return { run, calls }
}

describe('publish', () => {
  it('redacts the PR body, pushes the branch and opens the PR', async () => {
    const { run, calls } = recordingRunner('https://github.com/wgr-sa/p/pull/12')
    const out = await publish({
      dir: '/tmp/clone',
      repo: 'github.com/wgr-sa/p',
      token: 'TKN',
      base: 'main',
      branch: 'medic/fix-abcd-1',
      fix: { prTitle: 'Fix', prBody: 'leaked AKIAIOSFODNN7EXAMPLE in logs', summary: 's', changedFiles: ['x'], notVerified: null, sessionId: null, costUsd: 0 },
      run,
    })
    expect(out.prUrl).toBe('https://github.com/wgr-sa/p/pull/12')
    const prCreate = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'pr')!
    const bodyArg = prCreate.args[prCreate.args.indexOf('--body') + 1]
    expect(bodyArg).toContain('[REDACTED]')
    expect(bodyArg).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'push')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- publish`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/fix/publish.ts`**

```typescript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- publish`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/publish.ts apps/wgr-logs-medic/tests/publish.test.ts
git commit -m "feat(medic): deterministic publish (redact + push + gh pr create)"
```

---

## Task 15: Medic — orchestration + CLI (`fix`, `fix --resume`, `remediations`)

**Files:**
- Create: `apps/wgr-logs-medic/src/fix/run.ts`
- Modify: `apps/wgr-logs-medic/src/cli.ts`
- Modify: `apps/wgr-logs-medic/src/index.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `runFix(opts)` orchestrates one fix; the SDK `query()` wiring (`runQuery`, `generate`) lives here as the concrete `RunQuery`. CLI subcommands `fix --id|--signature [--project]`, `fix --resume <remediationId>`, `remediations [--project]`.

- [ ] **Step 1: Create `apps/wgr-logs-medic/src/fix/run.ts`** — the concrete SDK wiring + the orchestration. This is the one module that imports the SDK.

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ApiConfig } from '../config/env.js'
import type { FixTarget } from '../config/projects.js'
import type { Problem } from '../types.js'
import { getProblem } from '../api/problems.js'
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
async function runQuery(prompt: string, cwd: string, permissionMode: 'acceptEdits' | 'default' = 'acceptEdits'): Promise<QueryOutcome> {
  const iterator = query({
    prompt,
    options: {
      model: 'claude-opus-4-8',
      allowedTools: FIX_TOOLS,
      permissionMode,
      settingSources: ['project'],
      cwd,
      ...(process.env.WGR_AGENT_EFFORT ? { effort: process.env.WGR_AGENT_EFFORT as 'high' } : { effort: 'high' }),
    },
  })
  let resultText = ''
  let sessionId: string | null = null
  let costUsd = 0
  let success = false
  for await (const message of iterator) {
    if (message.type === 'result') {
      sessionId = message.session_id ?? sessionId
      costUsd = message.total_cost_usd ?? 0
      if (message.subtype === 'success') {
        resultText = message.result
        success = true
      }
    } else if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id ?? sessionId
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
```

> Note: confirm the SDK `result`/`system` message fields (`session_id`, `total_cost_usd`, `subtype`) against `@anthropic-ai/claude-agent-sdk@^0.3.170` types (mirror `apps/wgr-logs-agent/src/agent/runIntent.ts`, which reads `message.num_turns`/`message.subtype`/`message.result`). Adjust field access only if the installed types differ; do not change the control flow.

- [ ] **Step 2: Wire the CLI** — in `apps/wgr-logs-medic/src/cli.ts`, add the `fix` and `remediations` commands (keep the existing `scan`). Add imports at the top:

```typescript
import { fixEligible, loadProjects } from './config/projects.js'
import { requireApi, requireGithub, loadEnv } from './config/env.js'
import { getProblem } from './api/problems.js'
import { listRemediations } from './api/remediations.js'
import { runFix } from './fix/run.js'
```

Add the commands (before `program.parseAsync`):

```typescript
program
  .command('fix')
  .description('Fix one triaged problem and open a PR')
  .requiredOption('--project <name>', 'project name (from projects.yml)')
  .option('--id <problemId>', 'problem id to fix')
  .option('--projects <path>', 'path to projects.yml')
  .action(async (flags: { project: string; id?: string; projects?: string }) => {
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
```

- [ ] **Step 3: Export from `index.ts`** — add to `apps/wgr-logs-medic/src/index.ts`:

```typescript
export { runFix } from './fix/run.js'
```

- [ ] **Step 4: Typecheck + lint + build + load smoke**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic && node apps/wgr-logs-medic/dist/cli.js fix --help`
Expected: all exit 0; `fix --help` prints the options.

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/run.ts apps/wgr-logs-medic/src/cli.ts apps/wgr-logs-medic/src/index.ts
git commit -m "feat(medic): fix orchestration + CLI (fix, remediations)"
```

---

## Task 16: Medic — PR-as-conversation (resume on comments)

**Files:**
- Modify: `apps/wgr-logs-medic/src/fix/run.ts` (add `resumeFix`)
- Modify: `apps/wgr-logs-medic/src/cli.ts` (add `fix --resume`)
- Test: `apps/wgr-logs-medic/tests/fixer.test.ts` (extend: `buildResumePrompt`)

**Interfaces:**
- Produces: `buildResumePrompt(comments)` (pure, in `fixer.ts`); `resumeFix(deps)` re-clones the same branch, resumes the SDK session, re-verifies, pushes to the same branch, updates the remediation.

- [ ] **Step 1: Add `buildResumePrompt` + test** — in `apps/wgr-logs-medic/src/fix/fixer.ts`:

```typescript
export function buildResumePrompt(comments: string): string {
  return [
    `New review feedback arrived on the pull request you opened:`,
    comments,
    ``,
    `Apply the requested changes on the SAME branch. DO NOT push or open PRs — that is handled outside.`,
    `If a request is ambiguous, ask a clarifying question instead of guessing.`,
    `End with the same fenced json block as before (prTitle, prBody, summary, changedFiles).`,
  ].join('\n')
}
```

Add to `apps/wgr-logs-medic/tests/fixer.test.ts`:

```typescript
import { buildResumePrompt } from '../src/fix/fixer.js'

describe('buildResumePrompt', () => {
  it('embeds the comments and forbids pushing', () => {
    const p = buildResumePrompt('please rename the variable')
    expect(p).toContain('please rename the variable')
    expect(p.toLowerCase()).toContain('do not push')
  })
})
```

- [ ] **Step 2: Run to verify the new test fails then passes** (write the function in Step 1, so):

Run: `npm run test -w @wgr/wgr-logs-medic -- fixer`
Expected: PASS (was 3, now 4 tests).

- [ ] **Step 3: Add `resumeFix` to `apps/wgr-logs-medic/src/fix/run.ts`** — resume the stored session against a fresh clone of the same branch. Add the SDK resume variant of `runQuery`:

```typescript
import { Gh } from './git.js'
import { listRemediations } from '../api/remediations.js'
import { buildResumePrompt, parseFixResult } from './fixer.js'

async function resumeQuery(sessionId: string, prompt: string, cwd: string): Promise<QueryOutcome> {
  const iterator = query({
    prompt,
    options: {
      resume: sessionId,
      model: 'claude-opus-4-8',
      allowedTools: FIX_TOOLS,
      permissionMode: 'acceptEdits',
      settingSources: ['project'],
      cwd,
      effort: 'high',
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

  return withClone(
    target.repo,
    github.token,
    async (dir) => {
      const gh = new Gh(dir, github.token, execRunner)
      const comments = await gh.prComments(rem.prUrl as string)
      const outcome = await resumeQuery(rem.sessionId as string, buildResumePrompt(comments), dir)
      if (!outcome.success) throw new Error('resume session did not complete')
      const fix = parseFixResult(outcome.resultText)

      const v = await verify(dir, fix.changedFiles, execRunner)
      const git = new (await import('./git.js')).Git(dir, execRunner)
      await git.addAll()
      await git.commit(`${fix.prTitle} (review update)`)
      await git.push(rem.branch as string)

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
}
```

- [ ] **Step 4: Add the `fix --resume` CLI path** — in `apps/wgr-logs-medic/src/cli.ts`, extend the `fix` action: when `--resume <remediationId>` is passed, call `resumeFix` instead of `runFix`. Add `.option('--resume <remediationId>', 'resume an existing remediation on new PR comments')` to the `fix` command, import `resumeFix`, and at the top of the action:

```typescript
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
```

(Update the action's flag type to include `resume?: string`.)

- [ ] **Step 5: Typecheck + lint + build + load smoke**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic && node apps/wgr-logs-medic/dist/cli.js fix --help`
Expected: all exit 0; `--resume` listed.

- [ ] **Step 6: Commit**

```bash
git add apps/wgr-logs-medic/src/fix/run.ts apps/wgr-logs-medic/src/cli.ts apps/wgr-logs-medic/tests/fixer.test.ts
git commit -m "feat(medic): PR-as-conversation resume on review comments"
```

---

## Task 17: Deploy API + end-to-end live fix (operational)

**Files:** none (operational verification). Requires the API redeployed (new entities) + a configured repo + `WGR_GITHUB_TOKEN`.

- [ ] **Step 1: Full medic gate**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run test -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-api`
Expected: all green.

- [ ] **Step 2: Deploy the API** (new `remediations` + `project_context` tables auto-created by `synchronize:true`). Per the deploy reality (prod dir is not a git checkout): push `main` → wait for `build-api.yml` → on the VPS `cd /home/debian/wgr-logs && docker compose pull api && docker compose up -d api`. Confirm the container is `healthy` and logs show `RemediationsController` + `ProjectContextController` routes mapped.

- [ ] **Step 3: Configure the target** — add `tech/repo/defaultBranch/pathPrefix` to `~/.wgr-logs-medic/projects.yml` for prometerre; export `WGR_GITHUB_TOKEN` (fine-grained PAT, contents + pull-requests, no push to main).

- [ ] **Step 4: Re-scan so problems carry `tech`+`patternHash`**

```bash
set -a; . ./.env; set +a
node apps/wgr-logs-medic/dist/cli.js scan --window 120
```

- [ ] **Step 5: Fix the easiest problem → PR**

```bash
node apps/wgr-logs-medic/dist/cli.js fix --project prometerre --id <easiest-id>
# verify: a PR is opened on the repo; the remediation row exists:
node apps/wgr-logs-medic/dist/cli.js remediations --project prometerre
```

Expected: a PR on the target repo (small, localized fix), branch `medic/fix-<sig>-<ts>`, PR body redacted with a "Not verified" note where applicable; remediation status `pr_open`.

- [ ] **Step 6 (optional): exercise resume** — comment on the PR, then:

```bash
node apps/wgr-logs-medic/dist/cli.js fix --project prometerre --resume <remediationId>
```

Expected: the agent pushes an update to the same branch reflecting the comment.

- [ ] **Step 7: Commit any final adjustments**

```bash
git add -A apps/wgr-logs-medic
git commit -m "test(medic): phase 2 end-to-end verified (fix -> PR)"
```

---

## Out of scope for this plan (later)
- **Cross-project retrieval** of past remediations into the fixer prompt — the dedicated knowledge-base spec → plan, once these remediations accrue.
- **Desktop UI** — problems list + "Fix" button + PR status (the deferred Phase 1 follow-up).
- **Phase 3** — autonomous systemd loop, GitHub webhook (replacing comment polling), multi-project, auto-selection of the easiest problem.

## Self-review notes
- Spec coverage: fixer in throwaway clone (Tasks 11–13,15), deterministic gated outward step (Task 14), PR-as-conversation resume (Task 16), remediation + project_context persistence (Tasks 6–9), memory seams `tech`+`patternHash` (Tasks 3,5) + per-project context cache (Tasks 8,12), CLI-first trigger (Task 15), PR-only PAT auth (Task 1,10), tiered verification (Task 11) — all present. Cross-project retrieval, UI, Phase 3 explicitly deferred (matches spec §9).
- Type consistency: `ProblemCandidate`/`Problem` (`patternHash`, `tech`) ↔ `UpsertProblemDto` ↔ entity columns; `Remediation` shape ↔ `CreateRemediationDto`/entity; `FixResult` produced by `runFixer`, consumed by `publish`; `Runner` shared by `git.ts`/`verify.ts`/`clone.ts`/`publish.ts`.
- The two places to verify against real code before coding: (1) the SDK `result`/`system` message fields in Task 15 (`session_id`, `total_cost_usd`, `subtype`) — mirror `wgr-logs-agent/src/agent/runIntent.ts`; (2) `settingSources` / `resume` option names in `@anthropic-ai/claude-agent-sdk@^0.3.170`.
