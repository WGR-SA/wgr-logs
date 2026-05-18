# wgr-logs — guide projet

Stack d'observabilité auto-hébergée WGR : **Loki + Grafana + Alloy** sur S3 Infomaniak, avec un desktop **Nuxt 4 + Tauri 2** (`apps/wgr-logs-desk`) et une lib TS partagée (`packages/logs-client`).

## Architecture

- **Standalone** : reverse proxy Traefik dédié, deploy SSH autonome (n'utilise pas l'infra de `wgr-docker-admin`).
- **Domaines** : `<LOGS_DOMAIN>` (Grafana UI) et `<INGEST_DOMAIN>` (push Loki).
- **Stockage** : Infomaniak Swiss Backup S3 — souveraineté CH.
- **Alerting** : Grafana Alerting → Slack webhook + notifications natives Tauri (opt-in).

## Conventions

- **npm workspaces** (pas pnpm/yarn).
- **TypeScript strict**, pas de `any` injustifié, pas d'eslint-warning toléré.
- **UI en français** (clients suisses francophones), **code/identifiers en anglais**.
- **Comments rares** : seulement le *why*, pas le *what*. Pas de docstring multi-paragraphe.
- **Pas de code défensif** aux boundaries internes (lib ↔ app). Validation seulement aux frontières externes (HTTP, env, fichiers).
- **Identifier Tauri** : `ch.wgr.logs`. Updater via GitHub releases `latest.json`.
- **Nuxt + Tauri** : SSR enabled en dev (sinon vite-node IPC bug), `nitro.preset: 'static'` + `routeRules: { '/': { prerender: true } }` pour la build. Port dev **1421** (collide-free, le 1420 est pour wgr-clip).

## Gotchas

- **Tauri capabilities** (`src-tauri/capabilities/*.json`) : tout changement de permission impose un rebuild Rust complet.
- **Nuxt UI v4 + Tailwind v4** : palette via `@theme` dans `app/assets/css/main.css` (pas de `tailwind.config.ts`).
- **Loki labels** : peu cardinaux uniquement (app, env, host, level). JAMAIS user_id, request_id, trace_id en label — ils vont dans la ligne JSON.
- **Token d'ingestion** : un seul Bearer partagé, distinct du mot de passe Grafana. Tourne via `INGEST_AUTH_TOKEN`.

## Workflows

- `npm run stack:up` — démarre le compose local.
- `npm run dev:desk` — Nuxt seul (port 1421).
- `npm run tauri:dev:desk` — desktop en dev.
- `npm run deploy:stack` — push compose sur prod via SSH.

## Scope MVP (volontaire)

- Logs uniquement. Pas de métriques (Prom/Mimir) ni traces (Tempo) pour démarrer.
- Auth Grafana : BasicAuth Traefik (SSO/Authentik plus tard si besoin).
- Pas de mobile/web app : le desktop suffit.
