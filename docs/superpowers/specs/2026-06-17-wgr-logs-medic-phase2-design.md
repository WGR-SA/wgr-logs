# `wgr-logs-medic` — Phase 2 (Fix → PR) design

> Status: **design, to be planned next**.
> Builds on Phase 1 (shipped): scanner + signature + fixability + `problem` table + `/mgmt/projects/:project/problems`.
> Parent design: [`2026-06-17-wgr-logs-medic-design.md`](2026-06-17-wgr-logs-medic-design.md) (§7 Phasing, §4 Safety, §5 PR-as-conversation).

## 1. Summary

Phase 2 turns a triaged **problem** into **one pull request** on the matching project repo. A human stays the gate: the medic **proposes**, you review and merge. Curated and serial — one project (prometerre) first, one fix at a time, triggered from the CLI.

The fixer is an inner Claude Agent SDK `query()` running inside a **throwaway clone** of the target repo. The medic — not the agent — performs the **outward step** (push + PR): the agent's tools stop at edit + test in the clone; the medic redacts and publishes deterministically.

Phase 2 also lays **memory seams** (decided: *capture + per-project context*, cross-project retrieval deferred): every fix is recorded with a `tech` tag, a project-agnostic `pattern_hash`, and a fix summary, and per-project codebase understanding is generated once and cached. These accrue the corpus the later cross-project knowledge-base design will mine — without building retrieval before there is data to validate it against.

### Non-goals (explicit, this phase)
- No auto-merge; every change lands as a PR a human merges.
- No infra/prod changes; never touches production or `/data01`.
- No parallel PRs — strictly serial.
- No cross-project *retrieval into the prompt* (own design, after a corpus exists).
- No desktop "Fix" button yet (rides the deferred problems-list-view plan); Phase 2 is CLI-triggered.
- No autonomous loop / systemd / webhook / multi-project / auto-pick (Phase 3).

## 2. Decisions (this phase)

| Topic | Decision |
|---|---|
| **Trigger / where it runs** | CLI-first: `wgr-logs-medic fix --id <n>` (or `--signature <sig>`), on a dev machine. Needs `ANTHROPIC_API_KEY` + `WGR_GITHUB_TOKEN`. |
| **Repo auth** | Fine-grained PAT, **PR-only** (contents + pull-requests, no push to default branch), scoped to allowlisted repos, in `WGR_GITHUB_TOKEN`. Targets assumed on GitHub. |
| **Verification** | Best-effort tiered: `php -l` on changed files always; phpstan/psalm/test suite **if** the repo has them; a minimal regression test when feasible; else fall back to the human gate with a PR body stating what was **not** verified. |
| **Outward step** | **Deterministic orchestration**: the SDK fixer cannot push/`gh`; the medic's own code redacts + branches + pushes + opens the PR. |
| **Memory** | Capture + per-project `/init` context cached in our store. Cross-project retrieval deferred. |

## 3. Architecture

```
problem (Phase 1) ──▶ wgr-logs-medic fix --id N
                          │  GET problem from /mgmt
                          ▼
   resolve fix-config (repo, defaultBranch, pathPrefix, tech) from projects.yml
                          │
   shallow clone ──▶ THROWAWAY temp dir
                          │  no CLAUDE.md? → generate understanding once,
                          │                  cache in project_context, drop into clone
   map server path → repo path (strip pathPrefix)
                          ▼
   inner SDK query()  [Read,Edit,Write,Glob,Grep,Bash(scoped)] acceptEdits,
                      settingSources:['project'], effort high, Opus, maxTurns + maxBudgetUsd
                          │  edit → tiered verify → return {prTitle, prBody, summary, notVerified}
                          ▼
   medic (deterministic): redact prBody → create branch → push (PR-only PAT) → gh pr create
                          │  record remediation {pr_url, session_id, status, cost, summary, pattern_hash, tech}
                          ▼
   PR-as-conversation: `fix --resume <remediationId>` polls comments → query({resume}) →
                       push same branch → ... → you merge (merged) | close (wontfix)
```

Two SDK-using surfaces (scanner already exists, fixer is new) live in the **ESM** medic app, separate from the **CJS** API — the same split as `wgr-logs-agent`.

## 4. Components (units, each one responsibility)

- **`fix-config`** (`config/projects.ts` extension) — per-project `{ tech, repo, defaultBranch, pathPrefix }`, validated by Zod. `pathPrefix` strips the server path to the repo root. Only projects with a `repo` are fix-eligible (the allowlist).
- **`clone`** (`fix/clone.ts`) — shallow-clone a repo to a throwaway temp dir with the PR-only token; clean up on exit.
- **`path-map`** (`fix/path-map.ts`, pure) — `serverPath → repoPath` by stripping `pathPrefix`; returns null if the path is outside the project tree (skip with a clear reason).
- **`project-context`** (`fix/context.ts`) — if the clone has no `CLAUDE.md`, run a one-shot SDK understanding pass, persist via `/mgmt` `project_context` (keyed by repo), and write `CLAUDE.md` into the clone for `settingSources:['project']`. Reuse the cache when fresh.
- **`fixer`** (`fix/fixer.ts`) — build the inner `query()`: prompt (problem + redacted sample + repo path + cached context), tools, caps; run tiered verification; return a structured `FixResult { prTitle, prBody, summary, notVerified, sessionId, costUsd, changedFiles }`. The fixer has **no** push/`gh` tools.
- **`publish`** (`fix/publish.ts`, deterministic) — redact `prBody`, create branch, `git push`, `gh pr create`; return `{ prUrl, prNumber, branch }`. The single outward gate; logs every publish.
- **`remediation` client** (`api/remediations.ts`) — create/update/list remediations and upsert/get `project_context` via `/mgmt`.
- **`pattern-hash`** (`scan/signature.ts` extension, pure) — a project-agnostic hash (error class + message template, paths stripped) so the same bug class matches across projects. Backfilled onto `problem`.
- **CLI** (`cli.ts` extension) — `fix --id|--signature`, `fix --resume <remediationId>`, `remediations [--project p]`.

## 5. Data model (Postgres / TypeORM, surfaced via `/mgmt`)

- **`remediation`** (new): `{ id, problem_id (FK problem), repo, branch, pr_url, pr_number, session_id, status, cost_usd, summary, diff_stat, not_verified, created_at, updated_at }`.
  Status: `open → fixing → pr_open → (needs_input | changes_requested) → fixing → merged | wontfix`.
- **`problem`** (extend): `+ tech (text, nullable)`, `+ pattern_hash (text, nullable, indexed)`. Backfilled by the scanner; `tech` from fix-config.
- **`project_context`** (new): `{ id, repo (unique), tech, summary (text), updated_at }`.

Endpoints (admin-guarded, `/mgmt`):
- `POST/GET /mgmt/projects/:project/remediations`, `PATCH /mgmt/remediations/:id` (status/pr fields).
- `GET/PUT /mgmt/project-context/:repo`.

## 6. PR as a conversation

`session_id` is stored on the remediation. `fix --resume <remediationId>`:
1. `gh pr view <pr> --comments` (polling, MVP) — collect new human comments since `updated_at`.
2. `query({ resume: sessionId, prompt: <comments> })` in a fresh clone of the **same branch**.
3. Re-verify (tiered) → `publish` pushes to the same branch → update remediation.
4. Ambiguous fix → the agent posts a question as a PR comment, status `needs_input`, pauses.

Webhook-driven detection is Phase 3; MVP is on-demand polling via the CLI.

## 7. Safety model (inherited from parent §4, MVP-scoped)

- **Isolated throwaway clone** per fix; never touches prod nor `/data01`.
- **Repo allowlist** — only projects with a configured `repo`; start with prometerre alone.
- **PR-only fine-grained PAT** — no direct push to the default branch.
- **Redaction** — the problem `sample` is already redacted (Phase 1); the medic redacts the PR body again before publishing. No secret ever enters a public PR.
- **Deterministic outward gate** — publishing is the medic's code, logged; trivially disable-able.
- **Human gate** — PR review mandatory. Dedup by `signature` + a `wontfix` terminal state prevent re-opening the same fix in a loop.
- **Cost caps** — `maxBudgetUsd` + `maxTurns` per fix; abort and record `wontfix`-with-reason on overrun.

## 8. Open questions / risks

- **Fix quality on legacy code without tests** → weak verification; mitigated by tiered checks, a regression test when feasible, the `not_verified` note in the PR, and the human gate.
- **Server-path → repo-path mapping** — handled by `pathPrefix`; a path outside the tree (vendor, generated) is skipped with a reason rather than guessed.
- **prometerre repo identity** — the `repo` URL is a config value to be filled in; assumed GitHub under the WGR org.
- **`pattern_hash` quality** — validate the cross-project grouping on real data before the KB design relies on it.
- **Cost per fix** — monitor `cost_usd` on remediations; tune caps.

## 9. Out of scope (later)
- Cross-project remediation **knowledge base** (retrieval of similar past fixes into the prompt) — its own spec → plan, once Phase 2 has accrued remediations.
- Desktop problems-list view + "Fix" button — the deferred Phase 1 follow-up plan.
- **Phase 3** — autonomous systemd loop, GitHub webhook, multi-project, auto-selection.
