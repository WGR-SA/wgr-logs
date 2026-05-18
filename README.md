# wgr-logs

Self-hosted log aggregation for WGR sites, apps, and infrastructure.

> Loki + Grafana + Alloy on Infomaniak Swiss Backup S3, plus a Nuxt 4 + Tauri 2 desktop client and a shared TS SDK.

## Stack

| Layer | Tech |
|---|---|
| Backend | [Grafana Loki 3](https://grafana.com/oss/loki/) |
| Storage | Infomaniak Swiss Backup (S3) |
| Collector | [Grafana Alloy](https://grafana.com/docs/alloy/latest/) + Docker `loki` driver + Cloudflare Tail Worker |
| UI | Grafana OSS 11 |
| Alerting | Grafana Alerting → Slack + Tauri native notifications |
| Reverse proxy | Traefik v2.11 + Let's Encrypt |
| Desktop | Nuxt 4 + Tauri 2 (`apps/wgr-logs-desk`) |
| SDK | `@wgr/logs-client` (`packages/logs-client`) |

## Layout

```
.
├── docker-compose.yml     # full stack (Traefik + Loki + Grafana + Alloy)
├── docker/                # service configs
├── apps/wgr-logs-desk/    # desktop app
├── packages/logs-client/  # TypeScript SDK
├── scripts/deploy.sh      # SSH deploy
└── docs/connectors.md     # how to ship logs from any source
```

## Quickstart (local)

```bash
cp .env.example .env
# fill S3 + Slack creds
docker compose up -d
docker compose ps
open https://localhost   # Traefik routes; needs /etc/hosts entries for *.wgr.ch
```

## Connecting a source

See [`docs/connectors.md`](./docs/connectors.md) for ready-to-paste snippets:

- Docker apps (Nuxt, Strapi, NestJS) — `logging.driver: loki`
- Linux hosts (journald, nginx) — Alloy
- Cloudflare Workers — Tail Worker → HTTPS push

## Deploy

```bash
npm run deploy:stack
```

Pushes compose + configs to the prod VPS over SSH and restarts the stack.

## Desktop app

```bash
cd apps/wgr-logs-desk
npm install
npm run tauri:dev
```
