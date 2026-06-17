# `wgr-logs-medic` — Phase 3 (Autonomous, sandboxed) design

> Status: **design, to be planned next**.
> Builds on Phase 2 (shipped): fix→PR, remediation/project_context, memory seams. Reuses its `buildFixPrompt`, `parseFixResult`, `verify`, `publish`, clone-creds-strip.
> Parent: [`2026-06-17-wgr-logs-medic-design.md`](2026-06-17-wgr-logs-medic-design.md) §3 (the loop), §7 (Phase 3). Phase 2: [`2026-06-17-wgr-logs-medic-phase2-design.md`](2026-06-17-wgr-logs-medic-phase2-design.md).

## 1. Summary

Phase 3 makes the medic **autonomous and sandboxed**: it runs the fix agent inside a **Docker Sandbox (`sbx`)** microVM (egress-locked, no host secrets), scans **all allowlisted projects**, **auto-selects** the easiest unhandled problem, fixes it → PR, and reacts to PR feedback via a **GitHub webhook**. The human gate stays the PR (no auto-merge). Serial: one fix in flight.

The autonomy leap is **selection + reaction without a human driving each fix**; the sandbox is what makes unattended runs acceptable.

### Non-goals (this phase)
- No auto-merge — every change is a PR a human merges.
- No parallel fixes — strictly serial.
- No infra/prod changes by the agent; it only edits a throwaway clone, inside a microVM.

## 2. Decisions

| Topic | Decision |
|---|---|
| **Sandbox** | Docker Sandboxes (`sbx`, v0.33.x). The agent runs as **native `claude` inside the sandbox**; the host does clone/strip/verify/push. |
| **Egress** | `sbx policy` deny-by-default + allow only `api.anthropic.com` (scoped to the sandbox). |
| **Auth** | `sbx secret set anthropic <key>` — a **dedicated, budget-capped Anthropic API key**; the sbx proxy injects it, the key **never enters the VM**. |
| **Agent** | `claude -p "<buildFixPrompt>"` headless in the sandbox; reuse Phase 2's `buildFixPrompt` + `parseFixResult`. |
| **Loop** | `wgr-logs-medic auto` — deterministic: scan allowlisted projects → pick easiest unhandled → sandboxed fix → record. Serial. Scheduled via `/loop` (supervised) now; systemd packaging is a fast-follow. |
| **Multi-project** | `auto` iterates `fixEligible` projects. |
| **Webhook** | NestJS `POST /mgmt/webhooks/github` (HMAC-verified) captures PR review/comment/merge/close events → updates remediation state; the loop processes pending resumes. |
| **Resume** | Sandboxed (same as fix); triggered by webhook-flagged remediations instead of polling. |

## 3. Architecture

```
                    ┌──────────── HOST (where sbx + medic CLI run) ─────────────┐
  wgr-logs-medic auto │  for each fixEligible project:                          │
        (or /loop)     │    scan (Loki) → upsert problems → pick easiest        │
                       │    unhandled (no open/merged/fixing remediation,       │
                       │                not wontfix)                            │
                       │           │                                            │
                       │   clone repo (token) → strip clone creds               │
                       │           ▼                                            │
                       │   sbx create claude <clone>                            │
                       │   sbx policy allow network api.anthropic.com (scoped)  │
                       │   sbx secret(anthropic) → proxy injects, key NOT in VM  │
                       │           ▼                                            │
                       │   ┌──────── sbx microVM (no host secrets, egress-locked)│
                       │   │ claude -p "<buildFixPrompt>"  edits mounted clone   │
                       │   └─────────────────────────────────────────────────── │
                       │           ▼  (edits land on host workspace)            │
                       │   parseFixResult ← claude stdout                        │
                       │   verify (host: php -l, etc.)                          │
                       │   publish (host: redacted push + gh pr create, token)   │
                       │   sbx rm ; record remediation (pr_open)                 │
                       └────────────────────────────────────────────────────────┘
                                            ▲
         GitHub  ── webhook ──▶ POST /mgmt/webhooks/github (NestJS, HMAC-verified)
         (review/comment/merge/close)  → update remediation status; loop resumes
```

## 4. Components

### 4.1 Sandbox adapter (`fix/sandbox.ts`, medic)
- `runAgentInSandbox(opts): Promise<AgentOutcome>` — wraps the `sbx` lifecycle: `sbx create claude <cloneDir> --name <n>` → `sbx policy allow network api.anthropic.com` (scoped to `<n>`) → ensure `sbx secret` for anthropic is set → run `claude -p <prompt>` headless via `sbx run/exec` → capture stdout → `sbx rm <n>` (always, in `finally`). Pure arg-builders (`sbxCreateArgs`, `sbxPolicyArgs`, `sbxRunArgs`) unit-tested; the `sbx` calls behind the injected `Runner` (reuse `fix/git.ts`'s `Runner`).
- Returns `{ resultText, ... }`; the orchestrator parses it with the existing `parseFixResult`.
- **Replaces** Phase 2's `runQuery`/`resumeQuery` (SDK) in `run.ts`; everything else in `run.ts` (clone, strip, ensureProjectContext, verify, publish, remediation updates) is reused. `generateContext` also runs via the sandbox.

### 4.2 Auto loop (`auto/select.ts` + `auto/run.ts` + CLI `auto`)
- `selectNext(projects, problemsByProject, remediations): {project, problem} | null` (pure) — across all `fixEligible` projects, filter problems to **unhandled** (no remediation in `fixing|pr_open|needs_input|changes_requested|merged`, and not `wontfix`), pick the highest `fixabilityScore` (tie: highest `count`). Returns null if none.
- `auto` CLI: for each project `scan` (upsert) → fetch problems + remediations → `selectNext` → if one, run the sandboxed `runFix` → print. One fix per invocation (serial); `--max <n>` to do up to n sequentially. Also processes **pending resumes** first (remediations in `changes_requested`).
- Scheduling: documented `/loop 30m wgr-logs-medic auto`; systemd unit = fast-follow.

### 4.3 GitHub webhook (`apps/wgr-logs-api`, NestJS)
- `webhooks/github.controller.ts` — `POST /mgmt/webhooks/github`, **HMAC-SHA256 verify** of `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET` (reject if invalid; no AdminGuard — GitHub can't send a Bearer; the signature IS the auth).
- Handled events (find remediation by `pr_url`/`pr_number`):
  - `issue_comment.created` on a PR, `pull_request_review.submitted` → status `changes_requested`, store the latest comment text.
  - `pull_request.closed` + merged → remediation `merged`, problem `merged`.
  - `pull_request.closed` + not merged → remediation `wontfix`.
- Thin: it only updates DB state. The medic loop does the sandboxed resume work (the webhook makes the loop responsive without polling GitHub).
- `webhooks/webhooks.module.ts`; raw-body access for HMAC (configure `rawBody` in the Nest bootstrap).

### 4.4 Data
- `remediation`: add `pending_comment` (text, nullable) — the latest review feedback captured by the webhook, consumed by resume.
- `RemediationStatus` already has `changes_requested`, `merged`, `wontfix`, `failed`.

## 5. Safety model

- **microVM isolation** (sbx): the agent can't reach the host FS outside the clone, host Docker, host network/localhost, other sandboxes, or non-allowlisted domains; raw TCP/UDP/ICMP blocked.
- **Egress-locked** to `api.anthropic.com` only.
- **No secrets in the VM**: the Anthropic key is proxy-injected (never in VM); the GitHub token stays on the host (clone + push are host-side); the clone has its creds stripped before the sandbox.
- **Human gate**: PR review mandatory; webhook never merges. Serial + dedup-by-remediation-state prevents duplicate/looping PRs; `wontfix`/`failed` are terminal-ish.
- **Cost**: the dedicated key is budget-capped; `auto --max` bounds a run.
- **Webhook auth**: HMAC signature verification; reject unsigned/invalid.

## 6. Open questions / risks
- **sbx maturity** (v0.33, preview/nightly): pin the version; the live verification (needs `sbx login` + the dedicated key) confirms real behavior before unattended use.
- **`claude` auth in sbx**: confirm the sandbox uses the `sbx secret` anthropic key (vs host login) during the live test; fall back to an explicit key if needed.
- **`php` for verification** stays host-side (already works); no toolchain needed in the sandbox.
- **Webhook reachability**: GitHub → `https://<LOGS_DOMAIN>/mgmt/webhooks/github` (API already deployed). The repo webhook + secret are configured operationally.

## 7. Out of scope (later)
- systemd 24/7 unit + its deployment via the agent CLI (tonight: `/loop`/manual).
- The cross-project remediation **knowledge base** (data still accruing).
- Desktop UI.

## 8. Operational prerequisites (user)
- `sbx login` (Docker account); a **dedicated budget-capped `ANTHROPIC_API_KEY`** stored via `sbx secret set anthropic`.
- `GITHUB_WEBHOOK_SECRET` in the API `.env`; configure the repo webhook → `/mgmt/webhooks/github`.
