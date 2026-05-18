# Setup — deploy your own wgr-logs instance

Guide to deploy the stack on your own infrastructure (or to fork it for your org). If you're joining an existing instance, skip this — go straight to [`docs/shipper-docker.md`](docs/shipper-docker.md).

## Prerequisites

- 1 VPS (≥ 2 GB RAM, Debian/Ubuntu) with Docker installed
- 2 subdomains pointing to that VPS (DNS A records, **DNS only** if behind Cloudflare)
- 1 S3-compatible bucket (Infomaniak Swiss Backup, AWS S3, MinIO, etc.)
- 1 Slack incoming webhook (for alerts)
- `gh` CLI if you fork the repo

## 1. Set up DNS

Two subdomains:

| Subdomain | Points to | Purpose |
|---|---|---|
| `logs.<your-domain>` | VPS IP | Grafana UI + Management API (`/mgmt/*`) |
| `ingest.<your-domain>` | VPS IP | Loki push endpoint |

Use **A records** pointing directly to the VPS IP. No Cloudflare proxy (Let's Encrypt must be able to validate the HTTP-01 challenge — disable the orange cloud).

## 2. Provision S3 storage

Create 2 buckets:
- `<your-prefix>-chunks` — compressed log chunks
- `<your-prefix>-ruler` — alert rules

Generate a dedicated access_key + secret_key pair with read/write access to these 2 buckets only.

## 3. Clone + configure

```bash
# On your VPS (or locally for testing)
git clone https://github.com/wgr-sa/wgr-logs.git
cd wgr-logs
cp .env.example .env
nano .env
```

Variables to fill in `.env`:

| Var | Example | Notes |
|---|---|---|
| `LOGS_DOMAIN` | `logs.example.com` | No scheme |
| `INGEST_DOMAIN` | `ingest.example.com` | No scheme |
| `LETSENCRYPT_EMAIL` | `admin@example.com` | For Let's Encrypt notifications |
| `S3_ENDPOINT` | `s3.pub1.infomaniak.cloud` or `s3.amazonaws.com` | No scheme |
| `S3_REGION` | `us-east-1` or your region | |
| `S3_BUCKET_CHUNKS`, `S3_BUCKET_RULER` | your buckets | |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | your S3 credentials | |
| `GRAFANA_ADMIN_PASSWORD` | `$(openssl rand -base64 24)` | Grafana UI |
| `INGEST_AUTH_TOKEN` | `$(openssl rand -hex 32)` | BasicAuth for Loki push |
| `SLACK_WEBHOOK_URL` | from Slack admin | |
| `SLACK_CHANNEL` | `#alerts` or your channel | |
| `PG_DATABASE_PASSWORD` | `$(openssl rand -base64 32)` | Postgres |
| `WGR_API_ADMIN_TOKEN` | `$(openssl rand -hex 32)` | Admin UI |
| `WGR_API_REGISTER_TOKEN` | `$(openssl rand -hex 32)` | One-time agent enrolment |

Generate all tokens at once:

```bash
cat >> .env <<EOF
GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 24)
INGEST_AUTH_TOKEN=$(openssl rand -hex 32)
PG_DATABASE_PASSWORD=$(openssl rand -base64 32)
WGR_API_ADMIN_TOKEN=$(openssl rand -hex 32)
WGR_API_REGISTER_TOKEN=$(openssl rand -hex 32)
EOF
```

Store these tokens in a password manager (1Password / Bitwarden) — you'll need them for shippers and the desktop app.

## 4. Start the stack

```bash
docker compose up -d
docker compose ps
```

Wait ~30s, then verify:
```bash
curl https://<LOGS_DOMAIN>/api/health         # Grafana
curl https://<LOGS_DOMAIN>/mgmt/health        # API
curl https://<INGEST_DOMAIN>/ready            # Loki
```

If Let's Encrypt is stuck, check `docker compose logs traefik` — DNS must resolve correctly.

## 5. Log into Grafana

`https://<LOGS_DOMAIN>` → user `admin` / pass `$GRAFANA_ADMIN_PASSWORD`.

You'll see the Loki datasource provisioned + a "WGR — Overview" dashboard (empty until shippers send logs).

## 6. Install the desktop client

Download from GitHub Releases (`desk-vX.Y.Z`), OR build from source:

```bash
cd apps/wgr-logs-desk
npm install
npm run tauri:build
```

On first launch → **Settings** → fill in:
- Loki endpoint: `https://<INGEST_DOMAIN>`
- Grafana URL: `https://<LOGS_DOMAIN>`
- Token: `$INGEST_AUTH_TOKEN`
- Admin API URL: `https://<LOGS_DOMAIN>/mgmt`
- Admin token: `$WGR_API_ADMIN_TOKEN`

## 7. Connect your first server

On a Debian/Ubuntu with root access:

```bash
curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
  | sudo bash -s -- \
      --api-url https://<LOGS_DOMAIN>/mgmt \
      --register-token <WGR_API_REGISTER_TOKEN> \
      --ingest-token <INGEST_AUTH_TOKEN> \
      --ingest-url https://<INGEST_DOMAIN>/loki/api/v1/push \
      --name $(hostname)
```

The agent shows up in the desktop app → **Agents** tab → click it → add sources (pm2, cakephp, nginx, journald, etc.) → done.

For Docker shippers or PHP cron (shared hosting): see [`docs/shipper-docker.md`](docs/shipper-docker.md) and [`docs/shipper-php.md`](docs/shipper-php.md).

## 8. If you fork the repo

Three things to change if you run from your own fork:

### A. Docker images → your ghcr

In `docker-compose.yml`, replace `image: ghcr.io/wgr-sa/wgr-logs-api:latest` and `image: ghcr.io/wgr-sa/wgr-logs-shipper:latest` with your org. The `.github/workflows/build-*.yml` files have `IMAGE_NAME: wgr-sa/wgr-logs-...` — update those too.

### B. Tauri updater endpoint

`apps/wgr-logs-desk/src-tauri/tauri.conf.json` → `plugins.updater.endpoints` should point to your fork's GitHub Releases.

### C. Updater pubkey

Generate your own keypair:
```bash
npx --yes @tauri-apps/cli signer generate -w ~/.tauri/wgr-logs.key
```

- Public key goes in `tauri.conf.json` `plugins.updater.pubkey`
- Private key + password go into GH secrets: `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 9. Recover after a VPS crash

The compose preserves data in Docker volumes. Loki chunks are on S3 (sovereign). To restore on a fresh VPS:

1. Re-provision (Docker + this repo)
2. Re-point DNS records
3. Restore `.env` from your password manager
4. `docker compose up -d`

Historical logs are replayed automatically from S3. The Postgres database (agents/sources) is restored from `pg-backups`:

```bash
# On the new VPS, from the recovered backups
docker compose exec pg psql -U wgrlogs -d wgr_logs < /backups/daily/wgr_logs-LATEST.sql.gz
```

## See also

- [`docs/architecture.md`](docs/architecture.md) — diagrams + flows
- [`SYNC-WORKFLOW.md`](SYNC-WORKFLOW.md) — GitHub Actions workflows + secrets
- [`docs/runbook.md`](docs/runbook.md) — common incidents
