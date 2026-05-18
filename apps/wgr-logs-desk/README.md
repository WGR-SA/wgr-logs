# wgr-logs-desk

Desktop client for the wgr-logs stack. Nuxt 4 + Tauri 2.

## Pages

- **Dashboard** — stats (apps, lines/min, errors/min, hosts) + stacked area SVG chart (top 8 apps) + top apps table + recent errors (1h)
- **Live** — real-time tail via Loki WebSocket, label filters
- **Search** — LogQL query with 15min → 7d windows
- **Alerts** — polls Grafana Alertmanager + native OS notifications on firing
- **Agents** ⭐ (Phase B) — CRUD agents + sources, dynamic `SourceForm` generated from the API JSON schemas
- **Settings** — Loki endpoint + admin API URL + tokens (persisted via `@tauri-apps/plugin-store`)

## Dev

```bash
npm install                # from repo root (workspaces)
npm run dev:desk           # nuxt only, port 1421
npm run tauri:dev:desk     # full desktop app (compiles Rust)
```

## Build

```bash
npm run tauri:build:desk
```

Generates `.dmg` (macOS arm64+x64) and `.msi` / `.nsis.exe` (Windows x64). The build also creates updater artifacts (`*.tar.gz` + `*.sig`) for auto-update via GitHub Releases.

## First-time setup

Open **Settings**:

1. **Loki ingestion endpoint**: `https://<INGEST_DOMAIN>`
2. **Grafana URL (for Alertmanager)**: `https://<LOGS_DOMAIN>`
3. **Token (INGEST_AUTH_TOKEN)**: the token from the wgr-logs server `.env`

Click "Test Loki" → you should see the list of available labels.

**Management API** section (to drive agents from the desktop):

4. **Admin API URL**: `https://<LOGS_DOMAIN>/mgmt`
5. **Admin token (WGR_API_ADMIN_TOKEN)**: from the `.env`

Click "Test admin API" → you should see the number of registered agents.

## Icons

Drop your icon set under `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.icns, icon.ico). See [Tauri docs](https://tauri.app/v1/guides/features/icons/).

To generate the set from a 1024×1024 PNG:
```bash
cd apps/wgr-logs-desk
npx --yes @tauri-apps/cli icon /path/to/source-1024.png
```

## Updater

`src-tauri/tauri.conf.json` → `plugins.updater.pubkey` must be the minisign public key. The private key lives in GitHub secret `TAURI_SIGNING_PRIVATE_KEY`, used by `release-desk.yml`.

To generate a keypair:
```bash
npx --yes @tauri-apps/cli signer generate -w ~/.tauri/wgr-logs.key
```

## Release

```bash
# Bump version in package.json AND src-tauri/tauri.conf.json
git tag desk-vX.Y.Z
git push --tags
```

The workflow `.github/workflows/release-desk.yml` builds the macOS+Windows matrix and publishes a draft release. Validate via the GitHub UI.
