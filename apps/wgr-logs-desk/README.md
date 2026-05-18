# wgr-logs-desk

Desktop client for the WGR Logs stack. Nuxt 4 + Tauri 2 — pattern hérité de `wgr-clip` / `wgr-desk`.

## Pages

- **Dashboard** — stats (apps, lines/min, errors/min, hosts) + chart SVG stacked area (top 8 apps) + top apps table + erreurs récentes (1h)
- **Live** — tail temps réel via WebSocket Loki, filtres labels
- **Recherche** — query LogQL avec fenêtre 15min → 7j
- **Alertes** — poll Grafana Alertmanager + notifications natives OS sur firing
- **Agents** ⭐ (Phase B) — CRUD agents + sources, SourceForm dynamique généré depuis les JSON schemas de l'API
- **Réglages** — endpoint Loki + admin API URL + tokens (persistés via `@tauri-apps/plugin-store`)

## Dev

```bash
npm install                # from repo root (workspaces)
npm run dev:desk           # nuxt only, port 1421
npm run tauri:dev:desk     # full desktop app (compile Rust)
```

## Build

```bash
npm run tauri:build:desk
```

Generates `.dmg` (macOS arm64+x64) et `.msi` / `.nsis.exe` (Windows x64). Le build crée les updater artifacts (`*.tar.gz` + `*.sig`) pour l'auto-updater via GitHub Releases.

## Premier setup

Open **Réglages** :

1. **Endpoint d'ingestion Loki** : `https://<INGEST_DOMAIN>`
2. **URL Grafana (pour Alertmanager)** : `https://<LOGS_DOMAIN>`
3. **Token (INGEST_AUTH_TOKEN)** : le token du `.env` du serveur wgr-logs

Clique "Tester Loki" → tu dois voir la liste des labels disponibles.

Section **Management API** (pour piloter les agents) :

4. **URL admin API** : `https://<LOGS_DOMAIN>/mgmt`
5. **Token admin (WGR_API_ADMIN_TOKEN)** : le token du `.env`

Clique "Tester admin API" → tu dois voir le nombre d'agents enregistrés.

## Icons

Drop le set d'icônes sous `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.icns, icon.ico). Cf. [Tauri docs](https://tauri.app/v1/guides/features/icons/).

Pour générer le set depuis un PNG 1024×1024 :
```bash
cd apps/wgr-logs-desk
npx --yes @tauri-apps/cli icon /path/to/source-1024.png
```

## Updater

`src-tauri/tauri.conf.json` → `plugins.updater.pubkey` doit être la minisign public key. La privée est stockée en GitHub secret (`TAURI_SIGNING_PRIVATE_KEY`) utilisée par `release-desk.yml`.

Pour générer une paire :
```bash
npx --yes @tauri-apps/cli signer generate -w ~/.tauri/wgr-logs.key
```

## Release

```bash
# Bump version dans package.json ET src-tauri/tauri.conf.json
git tag desk-vX.Y.Z
git push --tags
```

Le workflow `.github/workflows/release-desk.yml` build la matrix macOS+Windows et publie un draft release. Tu valides via l'UI GitHub.
