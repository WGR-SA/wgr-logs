# wgr-logs-desk

Desktop client for the WGR Logs stack. Built with Nuxt 4 + Tauri 2 — same shape as `wgr-clip` / `wgr-desk`.

## Features

- **Live tail** with WebSocket against Loki (`/loki/api/v1/tail`)
- **LogQL search** with adjustable time window (15min → 7d)
- **Native OS notifications** when a Grafana alert transitions to firing
- **Settings** persisted via `@tauri-apps/plugin-store`

## Dev

```bash
npm install        # from repo root (workspaces)
npm run dev        # nuxt only, port 1421
npm run tauri:dev  # full desktop app
```

## Build

```bash
npm run tauri:build
```

Generates `.dmg` (macOS) + `.msi` / `.nsis.exe` (Windows). The build creates updater artifacts (`*.tar.gz` + `*.sig`) for the GitHub-releases-based updater.

## Configure on first run

Open Réglages and set:
- **Endpoint** : `https://<INGEST_DOMAIN>`
- **Grafana URL** : `https://<LOGS_DOMAIN>`
- **Token** : the shared `INGEST_AUTH_TOKEN` from the stack `.env`

Click "Tester la connexion" — should report the available labels.

## Icons

Drop your icon set under `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.icns, icon.ico). See [Tauri docs](https://tauri.app/v1/guides/features/icons/).

## Updater key

Replace `pubkey` in `src-tauri/tauri.conf.json` with your minisign public key. Store the matching private key as a GitHub secret (`TAURI_SIGNING_PRIVATE_KEY`).
