# wgr-logs — project guide

Self-hosted observability stack: **Loki + Grafana + Alloy + Postgres + NestJS API** on S3-compatible storage. Driven from a **Nuxt 4 + Tauri 2** desktop app (`apps/wgr-logs-desk`), with 3 shippers (Docker, bash, PHP cron) to collect logs from anywhere.

> Full picture: see [`docs/architecture.md`](docs/architecture.md).

## Architecture

- **Standalone** — own Traefik, own SSH deploy. Doesn't depend on other infra.
- **Domains** — `<LOGS_DOMAIN>` (Grafana UI + `/mgmt/*` for the API) and `<INGEST_DOMAIN>` (Loki push).
- **Storage** — S3-compatible buckets for Loki chunks + ruler (e.g. Infomaniak Swiss Backup for CH sovereignty).
- **Alerting** — Grafana Alerting → Slack webhook + native Tauri notifications (opt-in).
- **Managed agents** — NestJS API + Postgres expose `/mgmt/*` to drive shippers from the UI.

## Conventions

- **npm workspaces** (not pnpm/yarn).
- **TypeScript strict**. No unjustified `any`, no eslint warnings tolerated.
- **UI in French** (Swiss French clients), **code/identifiers in English**.
- **Rare comments** — explain *why*, not *what*. No multi-paragraph docstrings.
- **No defensive code** at internal boundaries (lib ↔ app). Validate only at external boundaries (HTTP, env, files).
- **NestJS pattern** — TypeORM entities explicitly listed in `database.config.ts` (no auto-discovery), DTOs with class-validator, `ClassSerializerInterceptor` + `@Exclude()` to prevent leaks (cf. `tokenHash`).
- **Tauri identifier** — `ch.wgr.logs`. Updater via GitHub Releases `latest.json`.
- **Nuxt + Tauri** — SSR enabled in dev (otherwise vite-node IPC bug), `nitro.preset: 'static'` + `routeRules: { '/': { prerender: true } }` for the build. Dev port **1421**.

## Gotchas

- **Tauri capabilities** (`src-tauri/capabilities/*.json`) — any permission change forces a full Rust rebuild.
- **Nuxt UI v4 + Tailwind v4** — palette via `@theme` in `app/assets/css/main.css` (no `tailwind.config.ts`).
- **Loki labels** — low cardinality only (app, env, host, level). NEVER user_id, request_id, trace_id as labels — put them in the JSON line.
- **Three distinct tokens** — `INGEST_AUTH_TOKEN` (Loki push), `WGR_API_ADMIN_TOKEN` (desktop UI), `WGR_API_REGISTER_TOKEN` (enrolment). Don't mix.
- **Path-based API, no subdomain** — `/mgmt/*` on `<LOGS_DOMAIN>`. Traefik router rule `Host && PathPrefix(/mgmt)` automatically wins priority over Grafana's `Host()`-only rule.
- **Docker healthcheck path must match app** — when the Nest global prefix changes (`/api` → `/mgmt`), also update the `healthcheck.test` in compose, otherwise Traefik filters the container as unhealthy and routes nowhere.
- **Debian persistent journal** — `/var/log/journal/`, not `/run/log/journal/`. Adapt the mount to `:/run/log/journal:ro` inside the container.
- **ETag-based reload** — shippers compare the local ETag (in `/state/last-etag`) with the API's. If the `RENDERED` file is ephemeral (Docker `/tmp/config.alloy`), DO NOT restore the ETag from state when `RENDERED` doesn't exist — false negative "nothing to reload".

## Workflows

- `npm run stack:up` — start the compose locally.
- `npm run dev:desk` — Nuxt only (port 1421).
- `npm run tauri:dev:desk` — desktop dev.
- `npm run deploy:stack` — push compose to prod via SSH.
- Connect a new server:
  - Docker: `examples/docker-compose.managed.yml` from the shipper
  - Linux: `curl install-shipper.sh | sudo bash -s -- --api-url ... --register-token ... --ingest-token ... --name ...`
  - Shared hosting: `wgr-logs-push.php` + cron

## Security

- `.env` never committed (`.gitignore`)
- `agent_token` bcrypt-hashed in Postgres, never leaked via the API (`@Exclude()` on `Agent.tokenHash`)
- Repo public (the code has no secrets). Docker images public on ghcr.

## MVP scope (intentional)

- Logs only. No metrics (Prom/Mimir) nor traces (Tempo) for now.
- Grafana auth: BasicAuth via Traefik (SSO/Authentik later if needed).
- API auth: single admin token + per-agent tokens (no multi-user RBAC for now).
- No mobile/web app — the Tauri desktop is enough.

For shipped phases + planned: see [`docs/ROADMAP.md`](docs/ROADMAP.md).
