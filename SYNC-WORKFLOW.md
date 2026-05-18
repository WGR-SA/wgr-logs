# Sync workflow

How code in this repo reaches production.

## Stack (Loki, Grafana, Alloy, Traefik)

1. Push to `main`. GitHub Actions workflow `deploy-stack.yml` triggers when files in `docker-compose.yml`, `docker/**`, or `.env.example` change.
2. The workflow SSHes into the prod VPS and runs `scripts/deploy.sh`:
   - `git pull`
   - `docker compose pull`
   - `docker compose up -d`
   - `docker compose ps` to verify.
3. Healthchecks must report `healthy` for Loki (`/ready`) and Grafana (`/api/health`) — otherwise the workflow fails.

## Desktop app (`apps/wgr-logs-desk`)

1. Bump `version` in `apps/wgr-logs-desk/package.json` and `src-tauri/tauri.conf.json`.
2. Tag: `git tag desk-vX.Y.Z && git push --tags`.
3. GitHub Actions `release-desk.yml` builds for macOS (arm64 + x64) and Windows (x64), signs each artifact with the project's minisign key, and creates a GitHub Release that contains:
   - `*.dmg` / `*.app.tar.gz` (macOS)
   - `*.msi` / `*.nsis.zip` (Windows)
   - `latest.json` (used by the in-app updater)
4. Existing installs auto-update via `tauri-plugin-updater`.

## Secrets

- `.env` lives only on the prod VPS, never committed.
- GitHub secrets: `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Prod VPS

- Host: `debian@<VPS_IP>`
- SSH key: `~/.ssh/wgr_logs`
- Project path: `~/wgr-logs/`
- Reverse proxy: Traefik (own instance, port 80/443)

## Pre-flight checklist

Before merging a stack PR:

- [ ] `.env.example` updated if new vars
- [ ] Healthchecks still pass locally (`docker compose ps` shows `healthy`)
- [ ] Provisioned dashboards / alert rules render in Grafana
- [ ] No secret committed (`git diff` review)
