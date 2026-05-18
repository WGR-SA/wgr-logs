# wgr-logs

Self-hosted log aggregation built on Loki + Grafana + Alloy, with **agents managed from a desktop UI** and sovereign object storage (S3-compatible).

```
┌─────────────────── stack VPS ───────────────────────────┐
│                                                          │
│  Traefik  →  Loki (S3)  ──►  ┌─────────────┐             │
│           →  Grafana    ──►  │  Postgres   │             │
│           →  API        ──►  │  + backups  │             │
│                              └─────────────┘             │
└──────────────────────────────────────────────────────────┘
              ▲              ▲              ▲
              │ push logs    │ poll config  │
              │              │              │
   ┌──────────┴──┐  ┌────────┴───┐  ┌───────┴─────┐
   │  Docker     │  │  bash      │  │  PHP cron   │
   │  shipper    │  │  installer │  │  (shared    │
   │             │  │            │  │   hosting)  │
   └─────────────┘  └────────────┘  └─────────────┘
        │
        │ admin UI
        ▼
   ┌─────────────┐
   │  Desktop    │
   │  (Tauri)    │
   └─────────────┘
```

## Endpoints (production)

After deploying with your own domains:

| URL pattern | Service | Notes |
|---|---|---|
| `https://<LOGS_DOMAIN>` | Grafana | Dashboards, Explore, Alerting |
| `https://<LOGS_DOMAIN>/mgmt` | Management API | NestJS, JSON, Bearer auth |
| `https://<INGEST_DOMAIN>` | Loki push | Basic auth |

`<LOGS_DOMAIN>` and `<INGEST_DOMAIN>` are set in `.env` (e.g. `logs.example.com` / `ingest.example.com`).

## How to connect a new server

| Profile | Tool | Doc |
|---|---|---|
| VPS with Docker | Image `ghcr.io/wgr-sa/wgr-logs-shipper:latest` | [`docs/shipper-docker.md`](docs/shipper-docker.md) |
| Linux VPS without Docker | `scripts/install-shipper.sh` (curl ∣ bash) | [`docs/shipper-bash.md`](docs/shipper-bash.md) |
| Shared hosting | `scripts/php-pusher/wgr-logs-push.php` via cron | [`docs/shipper-php.md`](docs/shipper-php.md) |
| Cloudflare Worker | Tail Worker (`apps/wgr-tail-collector`) | [`docs/cf-workers.md`](docs/cf-workers.md) |
| Browser / frontend | `@wgr/logs-browser` lib + collector Worker | [`docs/browser-collector.md`](docs/browser-collector.md) |

All shippers (except the PHP cron) support a **managed mode**: they poll the API every 60s. You drive their sources from the desktop UI — no more per-server JSON files to edit.

## Stack & repo layout

```
wgr-logs/
├── docker-compose.yml              # full stack (8 services)
├── docker/                         # Loki + Grafana provisioning configs
├── apps/
│   ├── wgr-logs-api/               # NestJS + TypeORM + Postgres (admin API)
│   ├── wgr-logs-desk/              # Nuxt 4 + Tauri 2 (admin UI)
│   └── wgr-logs-shipper/           # Docker image (managed + static modes)
├── packages/
│   ├── alloy-modules/              # 9 parameterised Alloy modules + JSON schema
│   └── logs-client/                # typed TS client for Loki API
├── scripts/
│   ├── deploy.sh                   # SSH deploy of the stack
│   ├── install-shipper.sh          # self-contained bash installer
│   └── php-pusher/wgr-logs-push.php # PHP cron shipper for shared hosting
└── docs/                           # detailed guides (see table above)
```

## Docs

- [`SETUP.md`](SETUP.md) — deploy your own instance from scratch
- [`docs/architecture.md`](docs/architecture.md) — overview, flows, security, schema
- [`docs/api.md`](docs/api.md) — REST endpoints reference (`/mgmt/*`)
- [`docs/shipper-docker.md`](docs/shipper-docker.md) | [`shipper-bash.md`](docs/shipper-bash.md) | [`shipper-php.md`](docs/shipper-php.md) — shipper guides
- [`docs/runbook.md`](docs/runbook.md) — common incidents
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — shipped phases + planned
- [`SYNC-WORKFLOW.md`](SYNC-WORKFLOW.md) — release & deploy workflows

## Local quickstart (stack itself)

```bash
cp .env.example .env
# Fill in: S3 credentials, domains, tokens (see SETUP.md)

docker compose pull
docker compose up -d

# Healthchecks
curl https://<LOGS_DOMAIN>/api/health      # Grafana
curl https://<LOGS_DOMAIN>/mgmt/health     # API
curl https://<INGEST_DOMAIN>/ready         # Loki
```

## Connect a server in 3 minutes

1. On a Debian/Ubuntu target with root access:
   ```bash
   curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
     | sudo bash -s -- \
         --api-url https://<LOGS_DOMAIN>/mgmt \
         --register-token <REGISTER_TOKEN> \
         --ingest-token <INGEST_TOKEN> \
         --ingest-url https://<INGEST_DOMAIN>/loki/api/v1/push \
         --name $(hostname)
   ```
2. Open the desktop app → **Agents** tab → your new server shows up.
3. Click it → "+ Add source" → pick type (pm2, cakephp, nginx, journald…) → agent applies within 60s.
4. Grafana Explore: `{host="your-server"}` → live logs.

## Uninstall a shipper

| Type | Command |
|---|---|
| Docker | `docker compose down -v` |
| Bash | `sudo bash install-shipper.sh --uninstall` |
| PHP | remove the cron + `rm -rf ~/wgr-logs` |

The agent stays in the DB (visible in UI). Delete from the UI to fully remove.

## Security

- `.env` is never committed (`.gitignore`)
- Per-agent tokens stored as bcrypt hashes in Postgres, never leaked via the API (`@Exclude()` enforced + tested)
- Three distinct tokens by role:
  - `INGEST_AUTH_TOKEN` (Loki push BasicAuth, shared across shippers)
  - `WGR_API_ADMIN_TOKEN` (admin UI)
  - `WGR_API_REGISTER_TOKEN` (one-time, for new agent enrollment)
- TLS via Let's Encrypt, auto-renewed by Traefik
- No OAuth/SSO yet — token-based, single-admin

## Contributing

```bash
npm install                            # workspaces: api, desk, lib, modules
npm run build:client                   # build the shared lib
npm test -w @wgr/logs-client           # vitest

# Iterate on the API
cd apps/wgr-logs-api && npm run start:dev

# Iterate on the desktop
npm run tauri:dev:desk

# Build the shipper image
docker build -t wgr-logs-shipper:dev -f apps/wgr-logs-shipper/Dockerfile .
```

## License

MIT
