# Roadmap wgr-logs

Snapshot du plan exécuté + reste à faire. Pour le plan détaillé historique, voir [`fancy-imagining-mountain.md`](#) (hors repo, dans les plans Claude).

## ✅ Livré

### Phase 1 — Foundation (stack VPS)

- Loki + Grafana + Alloy + Traefik sur Infomaniak Swiss Backup S3
- Domaines `<LOGS_DOMAIN>` (Grafana) + `<INGEST_DOMAIN>` (Loki push) + `<LOGS_DOMAIN>/mgmt` (API)
- TLS Let's Encrypt auto
- Provisioning Grafana : datasource Loki, alerting rules, contact point Slack, dashboard "Vue d'ensemble"
- Backup S3 souverain CH

### Phase 2 — Lib TS + Tauri desktop

- `packages/logs-client` — client TS typé pour Loki HTTP API + LogQL builder
- `apps/wgr-logs-desk` — Nuxt 4 + Tauri 2 :
  - Dashboard (stats + chart SVG stacked area + top apps + erreurs récentes)
  - Live tail (WebSocket Loki)
  - Search (LogQL avec time window)
  - Alerts (poll Grafana Alertmanager + notifications natives macOS)
  - Settings (persisté via `@tauri-apps/plugin-store`)

### Phase A — Shippers

- `packages/alloy-modules` — 9 modules Alloy paramétrables (pm2, cakephp, wordpress, prestashop, nginx, journald, docker, files + _header)
- `apps/wgr-logs-shipper` — image Docker (managed + static), publiée sur `ghcr.io/wgr-sa/wgr-logs-shipper:latest` multi-arch
- `scripts/install-shipper.sh` — bash installer self-contained avec modules embarqués (curl ∣ bash)
- `scripts/php-pusher/wgr-logs-push.php` — PHP cron pour mutu Infomaniak
- CI multi-arch via GitHub Actions

### Phase B — API + UI managed

- `apps/wgr-logs-api` — NestJS 10 + TypeORM + Postgres :
  - `POST /mgmt/agents/register` — enrôlement shipper
  - `GET /mgmt/agents` / `:id` / CRUD admin
  - `GET /mgmt/agents/:id/config` — polling shipper (renvoie ETag + rendered)
  - `POST /mgmt/agents/:id/heartbeat`
  - CRUD `/mgmt/agents/:agentId/sources`
  - `GET /mgmt/source-types` — catalogue JSON schema
  - `GET /mgmt/health`
- Auth : 3 rôles (admin / agent / register), Bearer tokens, bcrypt hash
- Compose étendu : `pg` + `api` + `pg-backup` (daily, retention 7d/4w/3m)
- Image `ghcr.io/wgr-sa/wgr-logs-api:latest` publiée
- UI desktop : pages `/agents` + `/agents/[id]` + composant `SourceForm` dynamique (généré depuis JSON schema)
- Shipper Docker en mode managed : poll API + reload Alloy via SIGHUP

### Phase C — Dogfood

- Le VPS wgr-logs lui-même devient un agent géré (`shipper` dans le compose racine)
- Sources `journald` + `nginx` du host visibles dans l'UI
- Validation end-to-end du flow managed sur la prod

### Docs

- `README.md` — overview
- `docs/architecture.md` — schémas + flows + décisions
- `docs/api.md` — référence endpoints
- `docs/shipper-docker.md` / `shipper-bash.md` / `shipper-php.md` — guides par profil
- `docs/runbook.md` — incidents
- `docs/connectors.md` (legacy, pointers vers les nouveaux docs)
- `SYNC-WORKFLOW.md` — déploiement & release

## ⏸ À faire

### Phase D — Cloudflare Workers (Tail Worker)

**Use case** : récupérer les logs des Workers WGR (`cf-worker-intl`, `cf-worker-queue`, etc.) sans poser d'agent.

**Livrables prévus** :
- `apps/wgr-tail-collector/` — Worker dédié déployé via wrangler
- `wrangler.toml` avec `tail_consumers` étendable
- `src/index.ts` handler `tail()` qui forward chaque event vers Loki
- `scripts/cf-tail/add-target.sh` — helper `wrangler tail-consumer add`
- Apparaît dans l'UI avec `shipper_kind=cf-tail` (sans last_seen classique)
- Auth : `INGEST_AUTH_TOKEN` en wrangler secret

**Effort estimé** : ~3h

### Phase E — Frontend browser

**Use case** : remonter les erreurs JS prod (apps Nuxt en prod, thèmes WP, SPA prestashop) côté navigateur.

**Livrables prévus** :
- `apps/wgr-browser-collector/` — Worker public Cloudflare avec Origin whitelist + rate limit
- `packages/logs-browser/` — lib npm `@wgr/logs-browser` :
  - `initLogger({ collector, app, env, release })` — auto-hook `window.onerror` + `unhandledrejection`
  - API manuelle `logger.error()` / `warn()` / `info()`
  - Batching 1s + sendBeacon sur pagehide
  - ~3 KB minified, zero deps
- `docs/browser-collector.md`
- Workflow CI `deploy-cf-collector.yml`

**Optionnel v2** : source maps (resolve stacks minifiés), Core Web Vitals (LCP/CLS/INP).

**Effort estimé** : ~4h

### Améliorations en backlog

- **Migrations TypeORM** explicites au lieu de `synchronize: true`
- **SSO/Authentik** sur Grafana (BasicAuth pour démarrer)
- **Multi-admin** : remplacer le single admin_token par OAuth + RBAC
- **Audit log** riche (qui a modifié quel agent/source quand)
- **Bash installer auto-update** : `wgr-shipper-poll` détecte une nouvelle version + replace lui-même
- **Mobile / web UI** : sortir les pages Vue en Nuxt SSR séparé si besoin
- **Discovery auto** : labels Docker → auto-création de sources de type `docker` par container

## Décisions différées (volontaire)

- **HA / replication** : pg single-instance suffit pour des centaines d'agents. Streaming replication si besoin futur.
- **Métriques (Prometheus)** : hors scope. Alloy supporte mais pas nécessaire pour ce stack.
- **Traces (Tempo)** : hors scope.
