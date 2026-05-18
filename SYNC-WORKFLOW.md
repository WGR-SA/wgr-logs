# Sync workflow

How code in this repo reaches production.

## Overview

```
Local  ──push main──►  GitHub  ──GH Actions──►  ghcr.io (images)
                                            └►  SSH VPS (compose pull + up)
```

4 workflows:

| Workflow | Trigger | Effect |
|---|---|---|
| `build-shipper.yml` | push touching `apps/wgr-logs-shipper/**` or `packages/alloy-modules/**`, tag `shipper-v*` | Build + push `ghcr.io/wgr-sa/wgr-logs-shipper` (amd64+arm64) |
| `build-api.yml` | push touching `apps/wgr-logs-api/**` or `packages/alloy-modules/**`, tag `api-v*` | Build + push `ghcr.io/wgr-sa/wgr-logs-api` (amd64+arm64) |
| `deploy-stack.yml` | push touching `docker-compose.yml`, `docker/**`, `scripts/deploy.sh` | SSH into VPS → `docker compose pull && up -d` |
| `release-desk.yml` | tag `desk-v*` | Build Tauri matrix (macOS arm64+x64, Windows x64) → signed artifacts → GitHub Release |

## Stack VPS

A commit changing compose or a config triggers `deploy-stack.yml`. It SSHes into the VPS, runs `git pull` (VPS has a clone of the repo), then `docker compose pull` + `up -d`.

⚠️ The VPS `.env` is **not** updated by the workflow — you must do this manually when adding a new env var:

```bash
scp -i ~/.ssh/<your-key> .env <user>@<vps-ip>:~/wgr-logs/
ssh -i ~/.ssh/<your-key> <user>@<vps-ip> 'cd ~/wgr-logs && docker compose up -d'
```

### Post-deploy healthchecks

The workflow checks after `up -d`:
- `curl /api/health` on Grafana
- `curl /ready` on Loki
- `curl /mgmt/health` on the API

If any fails, the workflow fails → inspect manually.

## Shipper image

A push touching the shipper → CI builds amd64+arm64 → pushes to ghcr. Target servers (Docker mode) that run `docker compose pull` pick up the new version.

Managed mode: agents auto-restart with the new image. The `agent.json` is preserved in the `shipper-state` volume — no re-enrollment.

## API image

A push touching the API → CI builds → pushes to ghcr → `deploy-stack.yml` (if compose changed in parallel) pulls + up. If only the image changes (not the compose), manually `docker compose pull api && up -d` on the VPS, OR trigger `deploy-stack` via a no-op commit on the compose.

## Desktop app (`apps/wgr-logs-desk`)

1. Bump `version` in `apps/wgr-logs-desk/package.json` AND `src-tauri/tauri.conf.json`
2. Tag: `git tag desk-vX.Y.Z && git push --tags`
3. `release-desk.yml` builds the matrix (macOS arm64+x64, Windows x64) + minisign signatures + GitHub Release
4. Existing installs auto-update via `tauri-plugin-updater` pointing at the release's `latest.json`

## Required secrets

### GitHub repo secrets

| Secret | Purpose |
|---|---|
| `SSH_PRIVATE_KEY` | Private key for SSH access to the VPS (used by `deploy-stack.yml`) |
| `SSH_HOST` | VPS IP |
| `SSH_USER` | VPS SSH user (e.g. `debian`) |
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key to sign Tauri builds |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the minisign key |
| `GITHUB_TOKEN` | Auto-provided by GH, used to push to ghcr |

### VPS `.env`

See `.env.example` at the repo root. Critical variables:

| Var | Notes |
|---|---|
| `LOGS_DOMAIN` / `INGEST_DOMAIN` | Traefik domains |
| `LETSENCRYPT_EMAIL` | Let's Encrypt notification email |
| `S3_*` | S3 storage credentials |
| `INGEST_AUTH_TOKEN` | Loki push BasicAuth |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin (UI) |
| `PG_DATABASE_*` | Postgres for the API |
| `WGR_API_ADMIN_TOKEN` | Admin token for the desktop UI |
| `WGR_API_REGISTER_TOKEN` | One-time, for enrolling new shippers |
| `SLACK_WEBHOOK_URL` | Grafana alert routing |

### Target server (shipper.env)

| Var | Notes |
|---|---|
| `WGR_INGEST_TOKEN` | = `INGEST_AUTH_TOKEN` on the VPS |
| `WGR_REGISTER_TOKEN` | = `WGR_API_REGISTER_TOKEN` on the VPS, one-time |

## Production VPS

- Host: `<your VPS hostname or IP>`
- SSH key: your private key path
- Project path: `~/wgr-logs/`
- Reverse proxy: Traefik (own instance, ports 80/443)

## Pre-flight checklist

Before merging a stack-touching PR:

- [ ] `.env.example` updated if new variable
- [ ] Healthchecks pass locally (`docker compose ps` shows `healthy`)
- [ ] Grafana / API provisioning renders correctly
- [ ] No secret committed (`git diff` review)
- [ ] If new TypeORM migration needed: manually create (`synchronize: true` for now)
- [ ] If Alloy module changes: test render locally (`bash apps/wgr-logs-shipper/lib/render.sh ...`)

## Rollback

```bash
# On the VPS
cd ~/wgr-logs
git reset --hard <previous-commit-sha>
docker compose pull
docker compose up -d --force-recreate
```

If the Postgres DB got broken by a schema change, restore from `pg-backup`:
```bash
docker compose exec pg psql -U wgrlogs -d wgr_logs < /backups/daily/wgr_logs-YYYYMMDD.sql.gz
```
