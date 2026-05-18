# wgr-logs

Self-hosted log aggregation pour WGR — Loki + Grafana + Alloy avec **agents pilotés depuis une UI desktop** et stockage souverain (Infomaniak Swiss Backup S3).

```
┌─────────────────── stack VPS wgr-logs ──────────────────┐
│                                                          │
│  Traefik  →  Loki (S3)  ──→  ┌─────────────┐             │
│           →  Grafana    ──→  │  Postgres   │             │
│           →  API        ──→  │  + backups  │             │
│                              └─────────────┘             │
└──────────────────────────────────────────────────────────┘
              ▲              ▲              ▲
              │ push logs    │ poll config  │
              │              │              │
   ┌──────────┴──┐  ┌────────┴───┐  ┌───────┴─────┐
   │  shipper    │  │  shipper   │  │  PHP cron   │
   │  Docker     │  │  bash      │  │  (mutu)     │
   └─────────────┘  └────────────┘  └─────────────┘
        │
        │ admin UI
        ▼
   ┌─────────────┐
   │ wgr-logs-   │
   │ desk (Tauri)│
   └─────────────┘
```

## Endpoints en prod

| URL | Service | Notes |
|---|---|---|
| `https://<LOGS_DOMAIN>` | Grafana | Dashboards, Explore, Alerting |
| `https://<LOGS_DOMAIN>/mgmt` | Management API | NestJS, JSON, Bearer auth |
| `https://<INGEST_DOMAIN>` | Loki push | Basic auth Bearer = ingest token |

## Comment brancher un nouveau serveur

| Profil | Outil | Doc |
|---|---|---|
| VPS Docker | Image `ghcr.io/wgr-sa/wgr-logs-shipper:latest` | [`docs/shipper-docker.md`](docs/shipper-docker.md) |
| VPS Linux sans Docker | `scripts/install-shipper.sh` (curl ∣ bash) | [`docs/shipper-bash.md`](docs/shipper-bash.md) |
| Hébergement mutualisé | `scripts/php-pusher/wgr-logs-push.php` en cron | [`docs/shipper-php.md`](docs/shipper-php.md) |
| Cloudflare Worker | Tail Worker (phase D, à venir) | — |
| Site front / browser | Lib `@wgr/logs-browser` (phase E, à venir) | — |

Tous les shippers (sauf le PHP cron) supportent un **mode managed** : ils pollent l'API toutes les 60s, tu pilotes leurs sources depuis l'app desktop, plus de JSON à éditer par serveur.

## Stack & repo layout

```
wgr-logs/
├── docker-compose.yml              # stack VPS (8 services)
├── docker/                         # configs Loki + Grafana provisioning
├── apps/
│   ├── wgr-logs-api/               # NestJS + TypeORM + Postgres (admin API)
│   ├── wgr-logs-desk/              # Nuxt 4 + Tauri 2 (admin UI)
│   └── wgr-logs-shipper/           # image Docker (managed + static)
├── packages/
│   ├── alloy-modules/              # 9 modules Alloy paramétrables + JSON schema
│   └── logs-client/                # client TS typé pour Loki API
├── scripts/
│   ├── deploy.sh                   # déploiement stack VPS via SSH
│   ├── install-shipper.sh          # installer bash self-contained
│   └── php-pusher/wgr-logs-push.php # PHP cron pour mutu
└── docs/                           # guides détaillés (voir tableau ci-dessus)
```

## Docs

- [`docs/architecture.md`](docs/architecture.md) — vue d'ensemble, flows, sécurité, schéma de données
- [`docs/api.md`](docs/api.md) — référence des endpoints `/mgmt/*`
- [`docs/shipper-docker.md`](docs/shipper-docker.md) | [`shipper-bash.md`](docs/shipper-bash.md) | [`shipper-php.md`](docs/shipper-php.md) — guides shippers
- [`docs/runbook.md`](docs/runbook.md) — incidents fréquents
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phases livrées + à venir
- [`SYNC-WORKFLOW.md`](SYNC-WORKFLOW.md) — release & deploy workflows

## Quickstart local (dev de la stack elle-même)

```bash
cp .env.example .env
# remplir les credentials Infomaniak S3, tokens, etc.

# Image API + shipper sont sur ghcr public
docker compose pull

# Démarrer
docker compose up -d

# Healthchecks
curl https://<LOGS_DOMAIN>/api/health      # Grafana
curl https://<LOGS_DOMAIN>/mgmt/health     # API
curl -fsS https://<INGEST_DOMAIN>/ready    # Loki
```

## Brancher en 3 min (le cas le plus courant)

1. Sur le serveur cible Debian/Ubuntu, en root :
   ```bash
   curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
     | sudo bash -s -- \
         --api-url https://<LOGS_DOMAIN>/mgmt \
         --register-token <REG> \
         --ingest-token <INGEST> \
         --name $(hostname)
   ```
2. Ouvre l'app desktop → onglet **Agents** → tu vois ton nouveau serveur
3. Clique dessus → "+ Ajouter une source" → choisis le type (pm2, cakephp, nginx, journald…) → l'agent applique dans la minute
4. Va dans Explore Grafana : `{host="ton-serveur"}` → logs vivants

## Désinstall sur un serveur

| Type | Commande |
|---|---|
| Docker | `docker compose down -v` |
| Bash | `sudo bash install-shipper.sh --uninstall` |
| PHP | retirer le cron + `rm -rf ~/wgr-logs` |

L'agent reste dans la DB (visible dans l'UI). Supprimer côté UI pour le retirer définitivement.

## Sécurité

- `.env` jamais commité (cf. `.gitignore`)
- Token agent stocké en bcrypt côté DB, jamais leak via l'API (test `@Exclude()` validé)
- 3 tokens distincts par rôle :
  - `INGEST_AUTH_TOKEN` (Basic auth Loki push, partagé par tous les shippers)
  - `WGR_API_ADMIN_TOKEN` (UI admin)
  - `WGR_API_REGISTER_TOKEN` (one-time pour enroller un nouvel agent)
- Cert TLS Let's Encrypt auto-renewed par Traefik
- Pas d'OAuth/SSO pour démarrer (token-based)

## Contribuer

```bash
# Setup local
npm install                            # workspaces : api, desk, lib, modules
npm run build:client                   # build la lib partagée
npm test -w @wgr/logs-client           # tests Vitest

# Itérer sur l'API
cd apps/wgr-logs-api && npm run start:dev

# Itérer sur le desktop
npm run tauri:dev:desk

# Commit & push (pre-commit hooks via .github/workflows/)
```
