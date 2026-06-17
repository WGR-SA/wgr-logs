# wgr-logs-medic — Phase 1 (Watch & Triage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the logs already in Loki, produce a deduplicated, fixability-ranked list of application problems per project — persisted via the API and queryable — touching no client code and opening no PRs.

**Architecture:** A new ESM workspace app `apps/wgr-logs-medic` queries Loki (via `@wgr/logs-client`), normalizes each error into a stable **signature**, groups + counts occurrences, scores **fixability** deterministically, and `POST`s the resulting **problems** to the NestJS API. The API gains a `problems` module (entity + admin-guarded `/mgmt/projects/:project/problems` routes) backed by Postgres. The desktop list view is a separate follow-up plan.

**Tech Stack:** TypeScript (strict), ESM (`NodeNext`) for the medic app, Vitest for unit tests, NestJS + TypeORM + Postgres for the API, `@wgr/logs-client` for Loki.

**Scope note:** Phase 1 is the backend core. Phase 2 (fix→PR) and Phase 3 (autonomous loop + self-ship) are separate plans per the design spec (`docs/superpowers/specs/2026-06-17-wgr-logs-medic-design.md`). The Phase 1 triage is **deterministic** (a pure heuristic over the parsed error); the SDK/LLM triage is an explicit later enhancement.

---

## File structure

```
apps/wgr-logs-medic/
  package.json                  @wgr/wgr-logs-medic, "type":"module", bin wgr-logs-medic
  tsconfig.json                 extends ../../tsconfig.base.json, NodeNext ESM (mirror of wgr-logs-agent)
  eslint.config.mjs             typescript-eslint flat config (mirror of wgr-logs-agent)
  src/
    cli.ts                      commander; `scan` subcommand
    index.ts                    public exports: runScan, loadProjects
    config/env.ts               Zod env (Loki + API), native .env fallbacks
    config/projects.ts          Zod project map (project -> { lokiSelector }) from ~/.wgr-logs-medic/projects.yml
    scan/signature.ts           pure: parseError(line) -> ParsedError (signature, category, file, line, template)
    scan/fixability.ts          pure: scoreFixability(parsed) -> { score, reason }
    scan/redact.ts              pure: redact(sample) -> sample with secrets masked
    scan/scanner.ts             runScan(deps): query Loki per project, group, build ProblemCandidate[]
    api/problems.ts             postProblem(config, project, candidate, fetch)
    types.ts                    ProblemCandidate + ParsedError types
  tests/
    signature.test.ts
    fixability.test.ts
    redact.test.ts
    scanner.test.ts

apps/wgr-logs-api/src/problems/
  problem.entity.ts             Problem entity (problems table)
  dto/upsert-problem.dto.ts     class-validator DTO
  problems.service.ts           upsert-by-(project,signature) + list-by-project
  problems.controller.ts        @Controller('projects/:project/problems'), AdminGuard
  problems.module.ts
apps/wgr-logs-api/src/config/database.config.ts   (modify: register Problem)
apps/wgr-logs-api/src/app.module.ts               (modify: import ProblemsModule)
```

---

## Task 1: Scaffold the `wgr-logs-medic` workspace

**Files:**
- Create: `apps/wgr-logs-medic/package.json`
- Create: `apps/wgr-logs-medic/tsconfig.json`
- Create: `apps/wgr-logs-medic/eslint.config.mjs`
- Create: `apps/wgr-logs-medic/src/index.ts` (placeholder)
- Modify: `package.json` (root — add workspace scripts)

- [ ] **Step 1: Create `apps/wgr-logs-medic/package.json`**

```json
{
  "name": "@wgr/wgr-logs-medic",
  "version": "0.1.0",
  "private": true,
  "description": "Log-driven remediation agent: watch Loki, triage recurring problems per project",
  "type": "module",
  "bin": {
    "wgr-logs-medic": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint \"src/**/*.ts\" --max-warnings=0",
    "test": "vitest run",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "@wgr/logs-client": "*",
    "commander": "^15.0.0",
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^22.0.0",
    "eslint": "^10.4.1",
    "typescript": "^5.5.4",
    "typescript-eslint": "^8.61.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/wgr-logs-medic/tsconfig.json`** (identical options to `apps/wgr-logs-agent/tsconfig.json`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"],
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noImplicitAny": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "tests", "dist"]
}
```

- [ ] **Step 3: Create `apps/wgr-logs-medic/eslint.config.mjs`** (copy from `apps/wgr-logs-agent/eslint.config.mjs` verbatim)

Run: `cp apps/wgr-logs-agent/eslint.config.mjs apps/wgr-logs-medic/eslint.config.mjs`

- [ ] **Step 4: Create `apps/wgr-logs-medic/src/index.ts`** (placeholder so the build succeeds)

```typescript
export const VERSION = '0.1.0'
```

- [ ] **Step 5: Add root scripts** — in `package.json` (root), add to `"scripts"` after `"test:agent"`:

```json
    "build:medic": "npm run build -w @wgr/wgr-logs-medic",
    "test:medic": "npm run test -w @wgr/wgr-logs-medic",
    "start:medic": "npm run start -w @wgr/wgr-logs-medic",
```

- [ ] **Step 6: Install + build**

Run: `npm install && npm run build -w @wgr/wgr-logs-medic`
Expected: install succeeds (new workspace linked), `dist/index.js` is emitted, exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/wgr-logs-medic package.json package-lock.json
git commit -m "feat(medic): scaffold wgr-logs-medic ESM workspace"
```

---

## Task 2: Error signature parsing (`scan/signature.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/types.ts`
- Create: `apps/wgr-logs-medic/src/scan/signature.ts`
- Test: `apps/wgr-logs-medic/tests/signature.test.ts`

- [ ] **Step 1: Create the shared types** in `apps/wgr-logs-medic/src/types.ts`

```typescript
export interface ParsedError {
  /** Stable hash identifying recurring occurrences of the same error. */
  signature: string
  /** e.g. "Error", "Warning", "Notice". */
  category: string
  /** Exception class if present, e.g. "Cake\\View\\Exception\\MissingHelperException". */
  exceptionClass?: string
  /** Source file the error points at, if any. */
  file?: string
  /** 1-based line number in `file`, if any. */
  line?: number
  /** Message with volatile bits normalized (numbers, quoted strings, paths). */
  template: string
}

export interface ProblemCandidate {
  signature: string
  category: string
  file?: string
  line?: number
  sample: string
  count: number
  fixabilityScore: number
}
```

- [ ] **Step 2: Write the failing test** in `apps/wgr-logs-medic/tests/signature.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { parseError } from '../src/scan/signature.js'

const CAKE_ERROR =
  '2026-06-17 10:49:00 Error: [Cake\\View\\Exception\\MissingHelperException] Helper class AttachmentHelper could not be found. (/data01/sites/prometerre/prod/prometerre.ch/vendor/cakephp/cakephp/src/View/HelperRegistry.php:126)'

const CAKE_NOTICE =
  "2026-06-17 10:52:10 Notice: Notice (8): Trying to get property 'slug' of non-object in [/data01/sites/prometerre/prod/prometerre.ch/src/Template/Services/view.ctp, line 13]"

describe('parseError', () => {
  it('extracts category, exception class and file:line for a CakePHP error', () => {
    const p = parseError(CAKE_ERROR)
    expect(p.category).toBe('Error')
    expect(p.exceptionClass).toBe('Cake\\View\\Exception\\MissingHelperException')
    expect(p.file).toBe('/data01/sites/prometerre/prod/prometerre.ch/vendor/cakephp/cakephp/src/View/HelperRegistry.php')
    expect(p.line).toBe(126)
  })

  it('extracts file:line from the "[file, line N]" notice form', () => {
    const p = parseError(CAKE_NOTICE)
    expect(p.category).toBe('Notice')
    expect(p.file).toBe('/data01/sites/prometerre/prod/prometerre.ch/src/Template/Services/view.ctp')
    expect(p.line).toBe(13)
  })

  it('produces the same signature for two occurrences differing only by line number in the message', () => {
    const a = parseError("2026-06-17 10:52:10 Notice: Notice (8): Trying to get property 'slug' of non-object in [/x/view.ctp, line 13]")
    const b = parseError("2026-06-17 11:00:00 Notice: Notice (8): Trying to get property 'slug' of non-object in [/x/view.ctp, line 14]")
    expect(a.signature).toBe(b.signature)
  })

  it('produces different signatures for different messages', () => {
    expect(parseError(CAKE_ERROR).signature).not.toBe(parseError(CAKE_NOTICE).signature)
  })

  it('is stable when the leading timestamp differs', () => {
    const a = parseError('2026-06-17 10:49:00 Error: boom (/x.php:1)')
    const b = parseError('2026-06-18 23:11:59 Error: boom (/x.php:1)')
    expect(a.signature).toBe(b.signature)
  })
})
```

- [ ] **Step 2b: Run the test to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- signature`
Expected: FAIL — `parseError` is not exported / module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/scan/signature.ts`**

```typescript
import { createHash } from 'node:crypto'
import type { ParsedError } from '../types.js'

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*/
const EXCEPTION = /\[([A-Za-z0-9_\\]+(?:Exception|Error))\]/
// "(/abs/path.ext:123)" or "[/abs/path.ext, line 123]"
const FILE_PAREN = /\((\/[^():]+):(\d+)\)/
const FILE_BRACKET = /\[(\/[^\],]+),\s*line\s*(\d+)\]/

/** Collapse volatile bits so recurring occurrences share a template. */
function templatize(message: string): string {
  return message
    .replace(/'[^']*'/g, "'S'") // single-quoted strings
    .replace(/"[^"]*"/g, '"S"') // double-quoted strings
    .replace(/\b\d+\b/g, '#') // bare numbers (line numbers, ids, counts)
    .replace(/\/[^\s():,\]]+/g, '<path>') // absolute paths
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseError(rawLine: string): ParsedError {
  const line = rawLine.replace(TIMESTAMP, '')

  const colon = line.indexOf(':')
  const category = colon === -1 ? 'Unknown' : line.slice(0, colon).trim().split(/\s+/)[0]

  const exMatch = EXCEPTION.exec(line)
  const exceptionClass = exMatch ? exMatch[1] : undefined

  const fileMatch = FILE_PAREN.exec(line) ?? FILE_BRACKET.exec(line)
  const file = fileMatch ? fileMatch[1] : undefined
  const lineNo = fileMatch ? Number.parseInt(fileMatch[2], 10) : undefined

  const template = templatize(line)

  const signature = createHash('sha256')
    .update([category, exceptionClass ?? '', file ?? '', template].join(' '))
    .digest('hex')
    .slice(0, 16)

  return { signature, category, exceptionClass, file, line: lineNo, template }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- signature`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/types.ts apps/wgr-logs-medic/src/scan/signature.ts apps/wgr-logs-medic/tests/signature.test.ts
git commit -m "feat(medic): error signature parsing"
```

---

## Task 3: Fixability scoring (`scan/fixability.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/scan/fixability.ts`
- Test: `apps/wgr-logs-medic/tests/fixability.test.ts`

- [ ] **Step 1: Write the failing test** in `apps/wgr-logs-medic/tests/fixability.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { scoreFixability } from '../src/scan/fixability.js'
import type { ParsedError } from '../src/types.js'

const base: ParsedError = { signature: 's', category: 'Error', template: 't' }

describe('scoreFixability', () => {
  it('rates a localized Notice (file:line known) as highly fixable', () => {
    const r = scoreFixability({ ...base, category: 'Notice', file: '/x/view.ctp', line: 13 })
    expect(r.score).toBeGreaterThanOrEqual(0.8)
  })

  it('rates an infra-flavoured error (no file) as low fixability', () => {
    const r = scoreFixability({ ...base, category: 'Error', template: 'SQLSTATE connection timed out' })
    expect(r.score).toBeLessThan(0.4)
  })

  it('boosts when a file:line is present vs absent', () => {
    const withLoc = scoreFixability({ ...base, file: '/x.php', line: 9 }).score
    const without = scoreFixability({ ...base }).score
    expect(withLoc).toBeGreaterThan(without)
  })

  it('always returns a score in [0,1] and a non-empty reason', () => {
    const r = scoreFixability(base)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
    expect(r.reason.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- fixability`
Expected: FAIL — `scoreFixability` not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/scan/fixability.ts`**

```typescript
import type { ParsedError } from '../types.js'

export interface Fixability {
  score: number
  reason: string
}

const INFRA = /\b(timed out|timeout|connection|refused|deadlock|SQLSTATE|out of memory|allowed memory|segmentation|gateway)\b/i

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function scoreFixability(p: ParsedError): Fixability {
  const reasons: string[] = []
  let score = 0.4 // unknown baseline

  if (INFRA.test(p.template)) {
    return { score: 0.2, reason: 'infra/runtime symptom (timeout/connection/memory/SQL) — not a localized code fix' }
  }

  if (p.category === 'Notice' || p.category === 'Warning') {
    score = 0.6
    reasons.push('notice/warning: usually a small guard')
  } else if (p.category === 'Error') {
    score = 0.45
    reasons.push('error: localized but verify intent')
  }

  if (p.file && p.line !== undefined) {
    score += 0.3
    reasons.push('stack trace localizes the fix (file:line)')
  } else {
    reasons.push('no file:line — harder to localize')
  }

  return { score: clamp(score), reason: reasons.join('; ') }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- fixability`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/scan/fixability.ts apps/wgr-logs-medic/tests/fixability.test.ts
git commit -m "feat(medic): deterministic fixability scoring"
```

---

## Task 4: Sample redaction (`scan/redact.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/scan/redact.ts`
- Test: `apps/wgr-logs-medic/tests/redact.test.ts`

- [ ] **Step 1: Write the failing test** in `apps/wgr-logs-medic/tests/redact.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { redact } from '../src/scan/redact.js'

describe('redact', () => {
  it('masks AWS-style access keys', () => {
    expect(redact('key AKIAIOSFODNN7EXAMPLE here')).toBe('key [REDACTED] here')
  })

  it('masks bearer tokens and long hex/base64 secrets', () => {
    expect(redact('Authorization: Bearer abcDEF123ghiJKL456mnoPQR789stu')).toContain('[REDACTED]')
    expect(redact('token=0123456789abcdef0123456789abcdef')).toContain('[REDACTED]')
  })

  it('masks key=value pairs for sensitive keys', () => {
    expect(redact('password=hunter2 foo=bar')).toBe('password=[REDACTED] foo=bar')
    expect(redact('api_key: "s3cr3tValue"')).toContain('[REDACTED]')
  })

  it('leaves ordinary text untouched', () => {
    expect(redact('Helper class AttachmentHelper could not be found.')).toBe('Helper class AttachmentHelper could not be found.')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- redact`
Expected: FAIL — `redact` not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/scan/redact.ts`**

```typescript
const RULES: Array<[RegExp, string]> = [
  // AWS access key IDs
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  // Bearer tokens
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
  // sensitive key=value / key: value (quoted or bare)
  [/\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization)\b(\s*[=:]\s*)("?)[^\s"]+\3/gi, '$1$2[REDACTED]'],
  // long hex/base64 blobs (>=32 chars)
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[REDACTED]'],
]

export function redact(input: string): string {
  let out = input
  for (const [re, repl] of RULES) out = out.replace(re, repl)
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- redact`
Expected: PASS (4 tests). If the `password=hunter2` case fails because the hex/base64 rule also matches, ensure the sensitive-key rule runs before the blob rule (it does — array order). Adjust only if a specific assertion fails.

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/scan/redact.ts apps/wgr-logs-medic/tests/redact.test.ts
git commit -m "feat(medic): redact secrets from log samples"
```

---

## Task 5: Project map + env config

**Files:**
- Create: `apps/wgr-logs-medic/src/config/projects.ts`
- Create: `apps/wgr-logs-medic/src/config/env.ts`
- Test: `apps/wgr-logs-medic/tests/projects.test.ts`

- [ ] **Step 1: Write the failing test** in `apps/wgr-logs-medic/tests/projects.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { ProjectSchema, parseProjects } from '../src/config/projects.js'

describe('ProjectSchema', () => {
  it('parses a project with a loki selector', () => {
    const p = ProjectSchema.parse({ name: 'prometerre', lokiSelector: '{host="ov-eda3ed", source="cakephp"}' })
    expect(p.name).toBe('prometerre')
  })

  it('rejects a project missing a selector', () => {
    expect(ProjectSchema.safeParse({ name: 'x' }).success).toBe(false)
  })
})

describe('parseProjects', () => {
  it('parses a YAML document into a list', () => {
    const yaml = 'projects:\n  - name: prometerre\n    lokiSelector:'s{host="ov-eda3ed", source="cakephp"}'\n'
    expect(parseProjects(yaml)).toHaveLength(1)
  })
})
```

> Note: in the test above, replace the malformed YAML literal with this exact string:
> `'projects:\n  - name: prometerre\n    lokiSelector: \'{host="ov-eda3ed", source="cakephp"}\'\n'`

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- projects`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/config/projects.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

export const ProjectSchema = z.object({
  name: z.string().min(1),
  /** A LogQL stream selector identifying this project's app logs in Loki. */
  lokiSelector: z.string().min(1),
})
export type Project = z.infer<typeof ProjectSchema>

const FileSchema = z.object({ projects: z.array(ProjectSchema) })

export function parseProjects(yaml: string): Project[] {
  return FileSchema.parse(parse(yaml)).projects
}

export function loadProjects(path?: string): Project[] {
  const file = path ?? join(homedir(), '.wgr-logs-medic', 'projects.yml')
  return parseProjects(readFileSync(file, 'utf8'))
}
```

- [ ] **Step 4: Implement `apps/wgr-logs-medic/src/config/env.ts`** (mirror the agent's `config/env.ts` fallback approach)

```typescript
import { z } from 'zod'

const EnvSchema = z.object({
  WGR_API_URL: z.string().optional(),
  WGR_API_ADMIN_TOKEN: z.string().optional(),
  WGR_INGEST_URL: z.string().optional(),
  WGR_INGEST_TOKEN: z.string().optional(),
  LOGS_DOMAIN: z.string().optional(),
  INGEST_DOMAIN: z.string().optional(),
  INGEST_AUTH_TOKEN: z.string().optional(),
})
export type Env = z.infer<typeof EnvSchema>

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source)
}

function https(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`
}

export interface ApiConfig {
  url: string
  adminToken: string
}
export function requireApi(env: Env): ApiConfig {
  const url = env.WGR_API_URL ?? (env.LOGS_DOMAIN ? `${https(env.LOGS_DOMAIN)}/mgmt` : undefined)
  if (!url) throw new ConfigError('Set WGR_API_URL or LOGS_DOMAIN')
  if (!env.WGR_API_ADMIN_TOKEN) throw new ConfigError('Set WGR_API_ADMIN_TOKEN')
  return { url: url.replace(/\/$/, ''), adminToken: env.WGR_API_ADMIN_TOKEN }
}

export interface LokiConfig {
  baseUrl: string
  token: string
}
export function requireLoki(env: Env): LokiConfig {
  const baseUrl = env.WGR_INGEST_URL ?? (env.INGEST_DOMAIN ? https(env.INGEST_DOMAIN) : undefined)
  const token = env.WGR_INGEST_TOKEN ?? env.INGEST_AUTH_TOKEN
  if (!baseUrl) throw new ConfigError('Set WGR_INGEST_URL or INGEST_DOMAIN')
  if (!token) throw new ConfigError('Set WGR_INGEST_TOKEN or INGEST_AUTH_TOKEN')
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}
```

- [ ] **Step 5: Run to verify the projects test passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- projects`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/wgr-logs-medic/src/config apps/wgr-logs-medic/tests/projects.test.ts
git commit -m "feat(medic): project map + env config"
```

---

## Task 6: The scanner (`scan/scanner.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/scan/scanner.ts`
- Test: `apps/wgr-logs-medic/tests/scanner.test.ts`

The scanner depends on a Loki reader and the project list, both injected (so it is unit-testable without network).

- [ ] **Step 1: Write the failing test** in `apps/wgr-logs-medic/tests/scanner.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { groupCandidates, type LokiReader } from '../src/scan/scanner.js'

const ERR = (ts: string, msg: string) => ({ ts, line: msg })

describe('groupCandidates', () => {
  it('groups identical errors by signature and counts them', () => {
    const lines = [
      '2026-06-17 10:00:00 Notice: Trying to get property \'slug\' of non-object in [/x/view.ctp, line 13]',
      '2026-06-17 10:01:00 Notice: Trying to get property \'slug\' of non-object in [/x/view.ctp, line 14]',
      '2026-06-17 10:02:00 Error: [App\\FooException] boom (/x/Foo.php:9)',
    ]
    const out = groupCandidates(lines)
    expect(out).toHaveLength(2)
    const notice = out.find((c) => c.category === 'Notice')!
    expect(notice.count).toBe(2)
    expect(notice.fixabilityScore).toBeGreaterThan(0)
    expect(notice.sample).toContain('Trying to get property')
  })

  it('orders candidates by fixability score descending', () => {
    const lines = [
      '2026-06-17 10:00:00 Error: SQLSTATE connection timed out',
      '2026-06-17 10:00:01 Notice: undefined in [/x.ctp, line 1]',
    ]
    const out = groupCandidates(lines)
    expect(out[0].category).toBe('Notice') // higher fixability first
  })

  it('redacts secrets in the stored sample', () => {
    const out = groupCandidates(['2026-06-17 10:00:00 Error: leaked AKIAIOSFODNN7EXAMPLE (/x.php:1)'])
    expect(out[0].sample).toContain('[REDACTED]')
    expect(out[0].sample).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})

describe('runScan (with injected reader)', () => {
  it('queries each project and returns candidates per project', async () => {
    const { runScan } = await import('../src/scan/scanner.js')
    const reader: LokiReader = async () => [
      '2026-06-17 10:00:00 Notice: x in [/a.ctp, line 1]',
      '2026-06-17 10:01:00 Notice: x in [/a.ctp, line 2]',
    ]
    const result = await runScan({
      projects: [{ name: 'prometerre', lokiSelector: '{host="h"}' }],
      reader,
      windowMs: 3_600_000,
      now: 1_700_000_000_000,
    })
    expect(result).toHaveLength(1)
    expect(result[0].project).toBe('prometerre')
    expect(result[0].candidates[0].count).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- scanner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/scan/scanner.ts`**

```typescript
import type { Project } from '../config/projects.js'
import type { ProblemCandidate } from '../types.js'
import { parseError } from './signature.js'
import { scoreFixability } from './fixability.js'
import { redact } from './redact.js'

/** Returns the first line of each error event in the window for a selector. */
export type LokiReader = (selector: string, startMs: number, endMs: number) => Promise<string[]>

export function groupCandidates(lines: readonly string[]): ProblemCandidate[] {
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

export interface ScanOptions {
  projects: readonly Project[]
  reader: LokiReader
  windowMs: number
  now: number
}

export interface ProjectScan {
  project: string
  candidates: ProblemCandidate[]
}

export async function runScan(opts: ScanOptions): Promise<ProjectScan[]> {
  const out: ProjectScan[] = []
  for (const project of opts.projects) {
    const lines = await opts.reader(project.lokiSelector, opts.now - opts.windowMs, opts.now)
    out.push({ project: project.name, candidates: groupCandidates(lines) })
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- scanner`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/scan/scanner.ts apps/wgr-logs-medic/tests/scanner.test.ts
git commit -m "feat(medic): scanner groups errors into ranked problem candidates"
```

---

## Task 7: Loki reader adapter + API poster

**Files:**
- Create: `apps/wgr-logs-medic/src/api/problems.ts`
- Test: `apps/wgr-logs-medic/tests/problems.test.ts`

- [ ] **Step 1: Write the failing test** in `apps/wgr-logs-medic/tests/problems.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { postProblem } from '../src/api/problems.js'

function recordingFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const cfg = { url: 'https://logs.example/mgmt', adminToken: 'ADMIN' }
const candidate = { signature: 's1', category: 'Notice', file: '/x.ctp', line: 13, sample: 'x', count: 4, fixabilityScore: 0.9 }

describe('postProblem', () => {
  it('PUTs/POSTs to the project problems route with Bearer admin auth', async () => {
    const { fetchImpl, calls } = recordingFetch(new Response('{}', { status: 201 }))
    await postProblem(cfg, 'prometerre', candidate, fetchImpl)
    expect(calls[0].url).toBe('https://logs.example/mgmt/projects/prometerre/problems')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer ADMIN')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ signature: 's1', count: 4, fixabilityScore: 0.9 })
  })

  it('throws on non-2xx', async () => {
    const { fetchImpl } = recordingFetch(new Response('nope', { status: 401 }))
    await expect(postProblem(cfg, 'p', candidate, fetchImpl)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @wgr/wgr-logs-medic -- problems`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/wgr-logs-medic/src/api/problems.ts`**

```typescript
import type { LokiClient } from '@wgr/logs-client'
import type { ApiConfig } from '../config/env.js'
import type { LokiReader } from '../scan/scanner.js'
import type { ProblemCandidate } from '../types.js'

export async function postProblem(
  config: ApiConfig,
  project: string,
  candidate: ProblemCandidate,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${config.url}/projects/${encodeURIComponent(project)}/problems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.adminToken}` },
    body: JSON.stringify(candidate),
  })
  if (!res.ok) throw new Error(`POST problem failed: ${res.status} ${await res.text()}`)
}

/** Build a LokiReader backed by @wgr/logs-client: returns the first line of each error event. */
export function lokiReader(client: LokiClient): LokiReader {
  return async (selector, startMs, endMs) => {
    const res = await client.queryRange({ query: selector, start: startMs, end: endMs, direction: 'backward', limit: 1000 })
    const lines: string[] = []
    for (const stream of res.data.result) {
      for (const [, line] of stream.values) lines.push(line)
    }
    return lines
  }
}
```

> If `res.data.result` / `stream.values` shapes differ, confirm against `packages/logs-client/src/types.ts` (`LokiQueryRangeResponse`) and adjust the field access only.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @wgr/wgr-logs-medic -- problems`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/wgr-logs-medic/src/api/problems.ts apps/wgr-logs-medic/tests/problems.test.ts
git commit -m "feat(medic): Loki reader adapter + problem POST client"
```

---

## Task 8: CLI wiring (`cli.ts` + `index.ts`)

**Files:**
- Create: `apps/wgr-logs-medic/src/cli.ts`
- Modify: `apps/wgr-logs-medic/src/index.ts`

- [ ] **Step 1: Replace `apps/wgr-logs-medic/src/index.ts`**

```typescript
export { runScan, groupCandidates } from './scan/scanner.js'
export { loadProjects } from './config/projects.js'
export { lokiReader, postProblem } from './api/problems.js'
export const VERSION = '0.1.0'
```

- [ ] **Step 2: Create `apps/wgr-logs-medic/src/cli.ts`**

```typescript
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
```

- [ ] **Step 3: Build + typecheck + lint**

Run: `npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/wgr-logs-medic/src/cli.ts apps/wgr-logs-medic/src/index.ts
git commit -m "feat(medic): scan CLI (dry-run + upsert)"
```

---

## Task 9: API `Problem` entity + registration

**Files:**
- Create: `apps/wgr-logs-api/src/problems/problem.entity.ts`
- Modify: `apps/wgr-logs-api/src/config/database.config.ts`

- [ ] **Step 1: Create `apps/wgr-logs-api/src/problems/problem.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

export type ProblemStatus = 'open' | 'fixing' | 'pr' | 'merged' | 'wontfix'

@Entity('problems')
@Unique(['project', 'signature'])
export class Problem {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ type: 'text' })
  project!: string

  @Column({ type: 'text' })
  signature!: string

  @Column({ type: 'text' })
  category!: string

  @Column({ type: 'text', nullable: true })
  file!: string | null

  @Column({ type: 'int', nullable: true })
  line!: number | null

  @Column({ type: 'text' })
  sample!: string

  @Column({ type: 'int', default: 0 })
  count!: number

  @Column({ name: 'fixability_score', type: 'float', default: 0 })
  fixabilityScore!: number

  @Column({ type: 'text', default: 'open' })
  status!: ProblemStatus

  @CreateDateColumn({ name: 'first_seen', type: 'timestamptz' })
  firstSeen!: Date

  @UpdateDateColumn({ name: 'last_seen', type: 'timestamptz' })
  lastSeen!: Date
}
```

- [ ] **Step 2: Register the entity** — in `apps/wgr-logs-api/src/config/database.config.ts`, add the import and list entry:

```typescript
import { Problem } from '../problems/problem.entity'
// ...
  entities: [Agent, Source, ConfigVersion, Problem],
```

- [ ] **Step 3: Build the API**

Run: `npm run build -w @wgr/wgr-logs-api` (or the API's build script — confirm via `apps/wgr-logs-api/package.json`)
Expected: exit 0 (entity compiles; `synchronize: true` will create the table at runtime).

- [ ] **Step 4: Commit**

```bash
git add apps/wgr-logs-api/src/problems/problem.entity.ts apps/wgr-logs-api/src/config/database.config.ts
git commit -m "feat(api): Problem entity"
```

---

## Task 10: API `problems` module (DTO + service + controller)

**Files:**
- Create: `apps/wgr-logs-api/src/problems/dto/upsert-problem.dto.ts`
- Create: `apps/wgr-logs-api/src/problems/problems.service.ts`
- Create: `apps/wgr-logs-api/src/problems/problems.controller.ts`
- Create: `apps/wgr-logs-api/src/problems/problems.module.ts`
- Modify: `apps/wgr-logs-api/src/app.module.ts`

- [ ] **Step 1: Create `dto/upsert-problem.dto.ts`**

```typescript
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class UpsertProblemDto {
  @IsString() signature!: string
  @IsString() category!: string
  @IsOptional() @IsString() file?: string
  @IsOptional() @IsInt() line?: number
  @IsString() sample!: string
  @IsInt() @Min(0) count!: number
  @IsNumber() @Min(0) @Max(1) fixabilityScore!: number
}
```

- [ ] **Step 2: Create `problems.service.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Problem } from './problem.entity'
import { UpsertProblemDto } from './dto/upsert-problem.dto'

@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem)
    private readonly problems: Repository<Problem>,
  ) {}

  list(project: string): Promise<Problem[]> {
    return this.problems.find({
      where: { project },
      order: { fixabilityScore: 'DESC', count: 'DESC', id: 'ASC' },
    })
  }

  async upsert(project: string, dto: UpsertProblemDto): Promise<Problem> {
    const existing = await this.problems.findOne({ where: { project, signature: dto.signature } })
    if (existing) {
      existing.category = dto.category
      existing.file = dto.file ?? null
      existing.line = dto.line ?? null
      existing.sample = dto.sample
      existing.count = dto.count
      existing.fixabilityScore = dto.fixabilityScore
      return this.problems.save(existing)
    }
    const created = this.problems.create({
      project,
      signature: dto.signature,
      category: dto.category,
      file: dto.file ?? null,
      line: dto.line ?? null,
      sample: dto.sample,
      count: dto.count,
      fixabilityScore: dto.fixabilityScore,
      status: 'open',
    })
    return this.problems.save(created)
  }
}
```

- [ ] **Step 3: Create `problems.controller.ts`**

```typescript
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { ProblemsService } from './problems.service'
import { UpsertProblemDto } from './dto/upsert-problem.dto'

@Controller('projects/:project/problems')
@UseGuards(AdminGuard)
export class ProblemsController {
  constructor(private readonly service: ProblemsService) {}

  @Get()
  list(@Param('project') project: string) {
    return this.service.list(project)
  }

  @Post()
  @HttpCode(201)
  upsert(@Param('project') project: string, @Body() dto: UpsertProblemDto) {
    return this.service.upsert(project, dto)
  }
}
```

- [ ] **Step 4: Create `problems.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Problem } from './problem.entity'
import { ProblemsService } from './problems.service'
import { ProblemsController } from './problems.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Problem]), AuthModule],
  providers: [ProblemsService],
  controllers: [ProblemsController],
})
export class ProblemsModule {}
```

- [ ] **Step 5: Wire into `app.module.ts`** — add the import and the module to the `imports` array (after `SourceTypesModule`):

```typescript
import { ProblemsModule } from './problems/problems.module'
// ... in imports: [...]
    ProblemsModule,
```

- [ ] **Step 6: Build the API**

Run: `npm run build -w @wgr/wgr-logs-api`
Expected: exit 0.

- [ ] **Step 7: Smoke test against the running stack** (the AdminGuard reads `ADMIN_TOKEN`; the deployed value equals the `.env` `WGR_API_ADMIN_TOKEN`)

```bash
set -a; . ./.env; set +a
BASE="https://$LOGS_DOMAIN/mgmt"
# upsert a synthetic problem
curl -s -o /dev/null -w "POST %{http_code}\n" -X POST "$BASE/projects/prometerre/problems" \
  -H "Authorization: Bearer $WGR_API_ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data '{"signature":"smoke1","category":"Notice","file":"/x.ctp","line":13,"sample":"smoke","count":3,"fixabilityScore":0.9}'
# list it back
curl -s "$BASE/projects/prometerre/problems" -H "Authorization: Bearer $WGR_API_ADMIN_TOKEN" | head -c 400; echo
```

Expected: `POST 201`, and the list returns the `smoke1` problem. (Requires the API rebuilt/redeployed so the new module + table exist.)

- [ ] **Step 8: Commit**

```bash
git add apps/wgr-logs-api/src/problems apps/wgr-logs-api/src/app.module.ts
git commit -m "feat(api): /mgmt/projects/:project/problems (list + upsert)"
```

---

## Task 11: End-to-end smoke (live Loki → ranked problems)

**Files:** none (operational verification).

- [ ] **Step 1: Create the project map** at `~/.wgr-logs-medic/projects.yml`

```yaml
projects:
  - name: prometerre
    lokiSelector: '{host="ov-eda3ed", source="cakephp"}'
```

- [ ] **Step 2: Dry-run the scan** (prints, does not POST)

```bash
set -a; . ./.env; set +a
node apps/wgr-logs-medic/dist/cli.js scan --window 120 --dry-run
```

Expected: a `[prometerre]` section listing problems easiest-first, e.g. lines like `0.90  x12  Notice  /data01/.../view.ctp:13`. No network writes.

- [ ] **Step 3: Real scan (upsert to API), then verify via the API**

```bash
node apps/wgr-logs-medic/dist/cli.js scan --window 120
curl -s "https://$LOGS_DOMAIN/mgmt/projects/prometerre/problems" -H "Authorization: Bearer $WGR_API_ADMIN_TOKEN" \
  | python3 -c "import sys,json;[print(round(p['fixabilityScore'],2),'x'+str(p['count']),p['category'],p.get('file'),p.get('line')) for p in json.load(sys.stdin)]"
```

Expected: the API returns prometerre problems ordered by `fixabilityScore` desc; samples are redacted; counts reflect grouped occurrences.

- [ ] **Step 4: Run the full medic test suite + typecheck/lint/build (final gate)**

```bash
npm run typecheck -w @wgr/wgr-logs-medic && npm run lint -w @wgr/wgr-logs-medic && npm run test -w @wgr/wgr-logs-medic && npm run build -w @wgr/wgr-logs-medic
```

Expected: all green.

- [ ] **Step 5: Commit any final adjustments**

```bash
git add -A apps/wgr-logs-medic
git commit -m "test(medic): phase 1 end-to-end verified against live Loki"
```

---

## Out of scope for this plan (later phases)
- Desktop app **problems list view** — a short follow-up plan (needs Nuxt UI exploration); the API endpoint + CLI already make Phase 1 testable.
- **LLM/SDK triage** to replace/augment the deterministic `fixability` heuristic.
- **Phase 2** (fix → PR, isolated clone, PR-as-conversation) and **Phase 3** (autonomous systemd loop + self-ship), each its own spec → plan.
- Scheduling the scan (cron/systemd) — Phase 1 runs the scan on demand via the CLI.

## Self-review notes
- Spec coverage: scanner + signature + dedup + fixability ranking + redaction + `problem` persistence + ranked query — all present (Tasks 2-11). App listing + LLM triage explicitly deferred (matches the spec's phasing).
- Types are consistent across tasks: `ParsedError`/`ProblemCandidate` (`types.ts`) ↔ `UpsertProblemDto` (API) ↔ POST body in `postProblem`. Field names match (`fixabilityScore`, `signature`, `count`, `file`, `line`, `category`, `sample`).
- The single place to verify against real code before coding: the `LokiQueryRangeResponse` shape used in `lokiReader` (Task 7, Step 3 note).
