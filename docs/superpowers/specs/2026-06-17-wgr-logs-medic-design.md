# `wgr-logs-medic` — log-driven remediation agent (design)

> Status: **approved design**, Phase 1 to be planned next.
> Builds on the existing wgr-logs stack (Loki + NestJS `/mgmt` API + Postgres + Tauri desktop app + the shipper that already feeds logs into Loki).

## 1. Summary

A **centralized agent** that reads application logs from Loki, groups recurring errors into **problems** per project, and — for the ones worth fixing — opens **one pull request at a time** on the matching project repo. The human stays the gate: the agent **proposes**, you review and merge. The desktop app is the cockpit (lists problems ranked by fix-simplicity, and the open PRs with their status).

The log pipeline (shipper → Loki) is the *input*. This is the *brain* on top of it.

### Non-goals (explicit)
- No auto-merge. Every change lands as a PR a human merges.
- No infra/prod changes, no edits on production servers or `/data01`.
- No parallel PRs — strictly serial, one in flight at a time.
- Not Claude Code `/loop` for the durable daemon (that is session-bound, expires in 3 days, dies with the terminal). The durable outer loop is **our own service**.

## 2. Architecture

```
Loki (already populated) ──▶ SCANNER  group errors by signature/project ──┐
                                │  upsert "problem" candidates             │ Postgres
        TRIAGE (SDK subagent, low effort, read-only)                       │
        category + fixability_score + file:line + redacted sample ─────────┘
                                │
              Desktop app: lists problems (easiest→hardest) + PRs + status
                                │  (you click "fix")
                                ▼
        FIXER  inner SDK query() inside a THROWAWAY CLONE of the target repo
               understand → edit → test → gh pr create → record remediation
                                │
        PR-as-conversation: you comment / it asks questions → it resumes its
        session → updates the same branch → ... → you merge (done) or close (wontfix)
```

Two planes, like the shipper: **data** (logs → problems) and **control** (you, via the app → fix → PR).

### Reuse (do not duplicate)
- `@wgr/logs-client` for Loki reads (same wrapper the shipper-ops agent uses).
- NestJS `/mgmt` API + Postgres + TypeORM for the new entities, surfaced to the app.
- The Claude Agent SDK harness/patterns already established in `apps/wgr-logs-agent` (ESM, `query()`, `canUseTool`, tool server).
- The desktop app for listing/cockpit.

> ESM/CJS: scanner + fixer use the SDK (ESM), so they run as a **separate process** from the CJS API — same split as `wgr-logs-agent`.

## 3. The loop (grounded in the Agent SDK)

Two nested loops:

- **Outer loop = our own deterministic service** (no LLM). Pseudo:
  ```
  while running:
    problems = scan()                      # Loki → grouped signatures
    p = pick_one(unhandled, easiest first) # by fixability_score, dedup by signature
    if none: sleep; continue               # idle backpressure
    run_fixer(p)                           # inner SDK session
    wait_for(merge | close | comments | question-answer)
    on merge → resolved; on close → wontfix; on comments → resume fixer
  ```
  Phase 1–2: triggered (CLI/cron/app click). Phase 3: a long-running systemd service on the wgr-logs server.

- **Inner loop = SDK `query({ prompt, options })`** per fix, in a throwaway clone:
  - `allowedTools: [Read, Edit, Write, Glob, Grep, Bash]`, `settingSources: ['project']` (respect the target repo's `CLAUDE.md`/conventions).
  - `permissionMode: 'acceptEdits'` (safe: edits live in a disposable clone), `maxTurns` + `maxBudgetUsd` caps per fix, `effort: 'high'`, Opus.
  - Completion detected via `ResultMessage.subtype === 'success'` plus a check that a PR exists.
  - **Triage** is a separate cheap subagent (`effort: 'low'`, read-only) to keep the outer context lean.

## 4. Permission & safety model

The risky action is **not** the edits (throwaway clone) — it is the **outward step** (`git push` / `gh pr create`). Therefore:

- **Isolated clone / worktree per fix.** The fixer never touches production nor `/data01`; it works on a fresh clone, pushes a branch, opens a PR.
- **`acceptEdits`** for edits + explicit `allowedTools` for build/test (`Bash(npm test)`, `Bash(composer ...)`), and a **deterministic gate** (a `canUseTool` callback or `PreToolUse` hook) intercepting `git push` / `gh pr create` — *we* decide when a PR is actually published, log it, and **redact** the description first. `bypassPermissions` is acceptable only inside a container sandbox (and never as root).
- **Repo allowlist.** Only explicitly allowlisted repos are eligible. Start with a single project.
- **Redaction.** Application logs can contain secrets/PII. The log `sample` attached to a problem is **redacted** before it enters any prompt or PR description (never leak a secret into a public PR).
- **GitHub App / fine-grained PAT** scoped to the allowlisted repos, PR-only (no direct push to `main`).
- **Human gate.** PR review is mandatory. Dedup by signature + a `wontfix` terminal state prevent re-opening the same fix in a loop.

## 5. PR as a conversation

The PR is a collaborative, **resumable** artifact (uses the SDK `session_id` resume).

- The fixer's `session_id` is stored on the `remediation`. When new input arrives, we resume: `query({ resume: sessionId, prompt: <comments/answer> })` — the agent remembers what it did and applies the feedback on the **same branch**.
- **Agent asks questions.** On an ambiguous fix the agent does *not* guess: it posts the question (PR comment + `status: needs_input` in the app) and pauses that remediation.
- **You comment → it revises.** New PR comments are detected by **polling** `gh pr view --comments` (MVP) → **GitHub webhook** (Phase 3). The agent resumes, pushes an update, the app reflects it.
- **Statuses:** `open → fixing → pr_open → (needs_input | changes_requested) → fixing → merged | wontfix`.

## 6. Data model (Postgres / TypeORM, surfaced via `/mgmt`)

- **`problem`**: `{ id, project, signature (hash), category, file, line, sample (redacted), count, first_seen, last_seen, fixability_score, status }`
- **`remediation`**: `{ id, problem_id, repo, branch, pr_url, session_id, status, cost_usd, created_at, updated_at }`

The app lists `problem` rows sorted by `fixability_score` (easiest first) and the linked `remediation`/PR status.

## 7. Phasing

| Phase | Deliverable | Touches client code? | Risk |
|---|---|---|---|
| **1 — Watch & triage** | scanner + signature grouping + triage subagent (category, fixability, file:line) + `problem` table + app listing ranked easiest→hardest. **First slice.** | no | ~none |
| **2 — Fix → PR (curated, one project)** | "fix" action → isolated clone → inner `query()` → gated `gh pr create` → PR-as-conversation (resume on comments/questions) → app tracks status | yes (PR; you merge) | medium |
| **3 — Autonomous loop + self-ship** | systemd service 24/7 on the wgr-logs server, deployed by the `wgr-logs-agent` CLI (the deferred v2 daemon seam); GitHub webhook; multi-project; optional auto-selection of the easiest problem | yes | high |

Each phase gets its own spec → plan → implementation cycle.

## 8. Phase 1 — detailed scope (the first slice)

**Goal:** "From the logs already in Loki, produce a ranked, deduplicated list of fixable problems per project, visible in the app — touching no code."

- **Scanner** (scheduled, e.g. every 15 min, or on-demand CLI): query Loki for error-level logs per project over a window.
- **Signature**: normalize each error into a stable signature (strip timestamps, request IDs, dynamic path segments; keep error class + `file:line` + message template). Group + count.
- **Triage subagent** (SDK, `effort: 'low'`, read-only): for each new/changed signature above a count threshold, assign `category`, a `fixability_score` (1-line/localized vs diffuse/infra — informed by the `file:line` the stack trace provides), and a short proposed approach. Redact the sample.
- **Persist** `problem` rows (upsert by signature). Expose read endpoints under `/mgmt`.
- **App**: list problems per project, sorted easiest→hardest, with count, category, `file:line`, and redacted sample.

**Success criteria:** for the first target project, the app shows a ranked list of recurring problems with a sensible fixability ordering, no code touched, no PRs.

## 9. Open questions / risks (to resolve in Phase 2)

- **Fix quality on legacy code without tests** → weak verification; mitigations: agent writes a minimal repro/test where possible, and the human merges.
- **Server-path → repo-path mapping** (a stack trace points at the deploy path on the server; must be rebased onto the repo tree).
- **Cost** per fix (`maxBudgetUsd` cap) and per triage (low effort, capped).
- **Fixability score reliability** — validate against the Phase 1 output before automating selection.

## 10. Out of scope (for now)
- Auto-merge, auto-selection (Phase 3 only, opt-in).
- Non-application problems (infra, config, data) — application exceptions first.
- Multi-PR parallelism.
