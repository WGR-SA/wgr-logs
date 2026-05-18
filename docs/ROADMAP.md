# wgr-logs roadmap

Snapshot of shipped phases + what's planned. Historical detailed plan lives outside the repo (in the user's private agent plans).

## ✅ Shipped

### Phase 1 — Stack foundation

- Loki + Grafana + Alloy + Traefik on S3-compatible object storage
- Domains: `LOGS_DOMAIN` (Grafana) + `INGEST_DOMAIN` (Loki push) + `LOGS_DOMAIN/mgmt` (API)
- Auto TLS via Let's Encrypt
- Grafana provisioning: Loki datasource, alerting rules, Slack contact point, overview dashboard
- Sovereign S3 backup

### Phase 2 — TS lib + Tauri desktop

- `packages/logs-client` — typed TS client for Loki HTTP API + LogQL builder
- `apps/wgr-logs-desk` — Nuxt 4 + Tauri 2:
  - Dashboard (stats + stacked area SVG + top apps + recent errors)
  - Live tail (Loki WebSocket)
  - Search (LogQL + time window)
  - Alerts (poll Grafana Alertmanager + native OS notifications)
  - Settings (persisted via `@tauri-apps/plugin-store`)

### Phase A — Shippers

- `packages/alloy-modules` — 9 parameterised Alloy modules (pm2, cakephp, wordpress, prestashop, nginx, journald, docker, files + _header)
- `apps/wgr-logs-shipper` — Docker image (managed + static), multi-arch `ghcr.io/wgr-sa/wgr-logs-shipper:latest`
- `scripts/install-shipper.sh` — self-contained bash installer with embedded modules (curl ∣ bash)
- `scripts/php-pusher/wgr-logs-push.php` — PHP cron for shared hosting
- Multi-arch CI via GitHub Actions

### Phase B — API + managed UI

- `apps/wgr-logs-api` — NestJS 10 + TypeORM + Postgres:
  - `POST /mgmt/agents/register` — shipper enrollment
  - `GET /mgmt/agents` / `:id` / admin CRUD
  - `GET /mgmt/agents/:id/config` — shipper polling (returns ETag + rendered)
  - `POST /mgmt/agents/:id/heartbeat`
  - CRUD `/mgmt/agents/:agentId/sources`
  - `GET /mgmt/source-types` — JSON schema catalog
  - `GET /mgmt/health`
- Auth: 3 roles (admin / agent / register), Bearer tokens, bcrypt hash
- Extended compose: `pg` + `api` + `pg-backup` (daily, 7d/4w/3m retention)
- Image `ghcr.io/wgr-sa/wgr-logs-api:latest` published
- Desktop UI: `/agents` + `/agents/[id]` pages + dynamic `SourceForm` (generated from JSON schemas)
- Docker shipper in managed mode: poll API + reload Alloy via SIGHUP

### Phase C — Dogfood

- The wgr-logs VPS itself is now a managed agent (`shipper` service in the root compose)
- Sources `journald` + `nginx` from the host visible in the UI
- End-to-end validation of the managed flow in production

### Documentation

- `README.md` — overview
- `SETUP.md` — deploy your own instance
- `docs/architecture.md` — diagrams + flows + design decisions
- `docs/api.md` — endpoints reference
- `docs/shipper-docker.md` / `shipper-bash.md` / `shipper-php.md` — per-profile guides
- `docs/runbook.md` — incidents
- `docs/connectors.md` — low-level patterns
- `SYNC-WORKFLOW.md` — deploy & release

## ⏸ Planned

### Phase D — Cloudflare Workers (Tail Worker)

**Use case**: collect logs from Cloudflare Workers without an agent (impossible in serverless).

**Planned deliverables**:
- `apps/wgr-tail-collector/` — dedicated Worker deployed via wrangler
- `wrangler.toml` with extendable `tail_consumers`
- `src/index.ts` `tail()` handler forwarding each event to Loki
- `scripts/cf-tail/add-target.sh` — helper for `wrangler tail-consumer add`
- Shows up in the UI as `shipper_kind=cf-tail` (without classic last_seen)
- Auth: `INGEST_AUTH_TOKEN` stored as a wrangler secret

**Estimated effort**: ~3h

### Phase E — Frontend browser

**Use case**: capture production JS errors from browser clients (Nuxt apps, WP themes, Prestashop SPAs).

**Planned deliverables**:
- `apps/wgr-browser-collector/` — public Cloudflare Worker with Origin allowlist + rate limit
- `packages/logs-browser/` — npm package `@wgr/logs-browser`:
  - `initLogger({ collector, app, env, release })` — auto-hook `window.onerror` + `unhandledrejection`
  - Manual API `logger.error()` / `warn()` / `info()`
  - Batching 1s + sendBeacon on pagehide
  - ~3 KB minified, zero deps
- `docs/browser-collector.md`
- CI workflow `deploy-cf-collector.yml`

**Optional v2**: source maps (resolve minified stacks), Core Web Vitals (LCP/CLS/INP).

**Estimated effort**: ~4h

### Backlog improvements

- **Explicit TypeORM migrations** instead of `synchronize: true`
- **SSO/Authentik** on Grafana (BasicAuth for now)
- **Multi-admin**: replace the single admin_token with OAuth + RBAC
- **Rich audit log** (who modified what, when)
- **Bash installer self-update**: `wgr-shipper-poll` detects a new version and replaces itself
- **Mobile/web UI**: extract Vue pages into a separate Nuxt SSR if needed
- **Docker autodiscovery**: container labels → auto-create `docker`-type sources

## Deferred decisions (intentional)

- **HA / replication**: pg single-instance is enough for hundreds of agents. Streaming replication if needed later.
- **Metrics (Prometheus)**: out of scope. Alloy supports it but not required for this stack.
- **Traces (Tempo)**: out of scope.
