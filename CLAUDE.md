# wgr-logs — guide projet

Stack d'observabilité auto-hébergée WGR : **Loki + Grafana + Alloy + Postgres + API NestJS** sur S3 Infomaniak, avec un desktop **Nuxt 4 + Tauri 2** (`apps/wgr-logs-desk`) pour piloter les agents, et 3 shippers (Docker, bash, PHP cron) pour collecter les logs partout.

> Pour la vue d'ensemble complète : voir [`docs/architecture.md`](docs/architecture.md).

## Architecture

- **Standalone** : reverse proxy Traefik dédié, deploy SSH autonome (n'utilise pas l'infra de `wgr-docker-admin`).
- **Domaines** : `<LOGS_DOMAIN>` (Grafana UI + `/mgmt/*` pour l'API) et `<INGEST_DOMAIN>` (push Loki).
- **Stockage** : Infomaniak Swiss Backup S3 — souveraineté CH.
- **Alerting** : Grafana Alerting → Slack webhook + notifications natives Tauri (opt-in).
- **Agents managés** : NestJS API + Postgres exposent `/mgmt/*` pour piloter les shippers depuis l'UI.

## Conventions

- **npm workspaces** (pas pnpm/yarn).
- **TypeScript strict**, pas de `any` injustifié, pas d'eslint-warning toléré.
- **UI en français** (clients suisses francophones), **code/identifiers en anglais**.
- **Comments rares** : seulement le *why*, pas le *what*. Pas de docstring multi-paragraphe.
- **Pas de code défensif** aux boundaries internes (lib ↔ app). Validation seulement aux frontières externes (HTTP, env, fichiers).
- **NestJS pattern** : entities TypeORM déclarées explicitement dans `database.config.ts` (pas d'auto-discovery), DTOs avec class-validator, ClassSerializerInterceptor + `@Exclude()` pour empêcher les leaks (cf. `tokenHash`).
- **Identifier Tauri** : `ch.wgr.logs`. Updater via GitHub releases `latest.json`.
- **Nuxt + Tauri** : SSR enabled en dev (sinon vite-node IPC bug), `nitro.preset: 'static'` + `routeRules: { '/': { prerender: true } }` pour la build. Port dev **1421** (collide-free, le 1420 est pour wgr-clip).

## Gotchas

- **Tauri capabilities** (`src-tauri/capabilities/*.json`) : tout changement de permission impose un rebuild Rust complet.
- **Nuxt UI v4 + Tailwind v4** : palette via `@theme` dans `app/assets/css/main.css` (pas de `tailwind.config.ts`).
- **Loki labels** : peu cardinaux uniquement (app, env, host, level). JAMAIS user_id, request_id, trace_id en label — ils vont dans la ligne JSON.
- **Tokens distincts** : `INGEST_AUTH_TOKEN` (Loki push), `WGR_API_ADMIN_TOKEN` (UI desktop), `WGR_API_REGISTER_TOKEN` (enrôlement). Ne pas mélanger.
- **API path-based, pas subdomain** : `/mgmt/*` sur `<LOGS_DOMAIN>` (le subdomain `<API_DOMAIN>` est pris par un autre service). Le router Traefik avec `Host && PathPrefix(/mgmt)` gagne la priorité automatiquement sur le `Host()` seul de Grafana.
- **Docker healthcheck path doit matcher l'app** : si le globalPrefix Nest change (`/api` → `/mgmt`), updater aussi la `healthcheck.test` du compose, sinon Traefik filter le container comme unhealthy et le route nulle part.
- **Journal Debian persistant** : `/var/log/journal/`, pas `/run/log/journal/`. Mount à adapter en `:/run/log/journal:ro` côté container.
- **ETag-based reload** : les shippers comparent l'ETag local (dans `/state/last-etag`) avec celui retourné par l'API. Si `RENDERED` file est éphémère (Docker `/tmp/config.alloy`), ne PAS restaurer l'ETag depuis state si le RENDERED n'existe pas, sinon faux-négatif "rien à reload".

## Workflows

- `npm run stack:up` — démarre le compose local.
- `npm run dev:desk` — Nuxt seul (port 1421).
- `npm run tauri:dev:desk` — desktop en dev.
- `npm run deploy:stack` — push compose sur prod via SSH.
- Brancher un nouveau serveur :
  - Docker : `examples/docker-compose.managed.yml` du shipper
  - Linux : `curl install-shipper.sh | sudo bash -s -- --api-url ... --register-token ... --ingest-token ... --name ...`
  - Mutu : `wgr-logs-push.php` + cron

## Sécurité

- `.env` jamais commité (cf. `.gitignore`)
- `agent_token` stocké en bcrypt dans pg, jamais leak via l'API (cf. `@Exclude()` sur `Agent.tokenHash`)
- Repo public (le code n'a pas de secret). Images Docker publiques sur ghcr.

## Scope MVP (volontaire)

- Logs uniquement. Pas de métriques (Prom/Mimir) ni traces (Tempo) pour démarrer.
- Auth Grafana : BasicAuth Traefik (SSO/Authentik plus tard si besoin).
- Auth API : single admin token + per-agent tokens (pas de RBAC multi-user pour démarrer).
- Pas de mobile/web app : le desktop Tauri suffit.

Pour le détail des phases livrées + reste à faire : voir [`docs/ROADMAP.md`](docs/ROADMAP.md).
