# Architecture wgr-logs

Vue d'ensemble de la stack, des composants, des flux et des choix de design.

## Vue d'ensemble

```
┌─────────────────────────────────── VPS wgr-logs (<VPS_IP>) ───────────────────────────────────┐
│                                                                                                   │
│    Internet ──443──► Traefik v2.11 ─┬─► Grafana (<LOGS_DOMAIN> root)                                │
│                       │             ├─► API     (<LOGS_DOMAIN>/mgmt)                                │
│                       │             └─► Loki    (<INGEST_DOMAIN>)                                   │
│                       │                                                                           │
│                       │  réseau Docker `wgr-logs` ────────────────────────────────────────┐       │
│                       │                                                                   │       │
│                       │   ┌────────────────────────────────────┐                          │       │
│                       └──►│ shipper (managed, dogfood)         │                          │       │
│                           │   - tail journald + nginx          │                          │       │
│                           │   - poll API                       │                          │       │
│                           └──────────────┬─────────────────────┘                          │       │
│                                          │                                                │       │
│                       ┌──────────────────┴───────────────────┐  ┌──────────────────────┐  │       │
│                       │ Loki 3.2                             │  │ Postgres 16          │  │       │
│                       │   chunks → S3 Infomaniak             │  │  + pg-backup daily   │  │       │
│                       │   ruler  → S3 Infomaniak             │  └──────────┬───────────┘  │       │
│                       │   WAL    → loki-data Docker volume   │             │              │       │
│                       └──────────────────────────────────────┘             │              │       │
│                                                                            │              │       │
│                                                          ┌─────────────────┴───────────┐  │       │
│                                                          │  wgr-logs-api (NestJS)      │  │       │
│                                                          │   /mgmt/agents/*            │  │       │
│                                                          │   /mgmt/source-types        │  │       │
│                                                          │   /mgmt/health              │  │       │
│                                                          └─────────────────────────────┘  │       │
│                                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                  ▲                                                  ▲
       <INGEST_DOMAIN> │ push                            <LOGS_DOMAIN>/mgmt │ poll config + heartbeat
                  │                                                  │
   ┌──────────────┴──────────────┐         ┌────────────────────────┴──────────────────────────┐
   │                             │         │                                                   │
   │  Shipper Docker (ghcr)      │         │  Bash installer  (Alloy + systemd)                │
   │   poll /agents/<id>/config  │         │   /usr/local/bin/wgr-shipper-poll                 │
   │   reload alloy on change    │         │   systemctl reload alloy                          │
   │                             │         │                                                   │
   └─────────────────────────────┘         └───────────────────────────────────────────────────┘
                                                              │
                                                              │ (cron, pas de daemon)
                                                              ▼
                                                  ┌──────────────────────────────┐
                                                  │ PHP cron (mutu Infomaniak)   │
                                                  │   wgr-logs-push.php          │
                                                  │   glob + offset + curl push  │
                                                  └──────────────────────────────┘

           ┌──────────────────────────┐
           │ wgr-logs-desk            │  Bearer admin_token
           │ (Nuxt 4 + Tauri 2)       │  ───────────────────►  <LOGS_DOMAIN>/mgmt
           │   Dashboard / Live /     │
           │   Search / Alerts /      │
           │   Agents (CRUD sources)  │
           └──────────────────────────┘
```

## Services Docker (compose racine)

| Service | Image | Volumes | Rôle |
|---|---|---|---|
| `traefik` | traefik:v2.11 | `traefik-letsencrypt` | TLS Let's Encrypt + reverse proxy avec middlewares CORS |
| `loki` | grafana/loki:3.2 | `loki-data` | Ingestion logs, chunks vers S3 |
| `grafana` | grafana/grafana-oss:11.3 | `grafana-data` | UI dashboards, Explore, Alerting (provisioning auto via `docker/grafana/`) |
| `pg` | postgres:16-alpine | `pg-data` | DB pour l'API |
| `pg-backup` | prodrigestivill/postgres-backup-local:16 | `pg-backups` | Dump quotidien, retention 7d/4w/3m |
| `api` | ghcr.io/wgr-sa/wgr-logs-api:latest | — | NestJS, expose `/mgmt/*` |
| `shipper` | ghcr.io/wgr-sa/wgr-logs-shipper:latest | `shipper-state` + host mounts | Dogfood : le VPS est son propre agent |

## Stockage

- **Chunks Loki** (logs compressés) → S3 Infomaniak (`wgr-logs-chunks`)
- **Ruler Loki** (règles d'alerte) → S3 Infomaniak (`wgr-logs-ruler`)
- **WAL Loki** (write-ahead log, ~30 min de buffer) → volume Docker local `loki-data`
- **Postgres** (agents, sources, config_versions) → volume Docker `pg-data`
- **Dumps pg quotidiens** → volume Docker `pg-backups`
- **Grafana** (dashboards persistés, plugins) → volume Docker `grafana-data`

## Schéma Postgres (managé par TypeORM)

```sql
agents
  id            UUID PK
  name          TEXT
  hostname      TEXT
  env           TEXT (default 'prod')
  cluster       TEXT
  token_hash    TEXT       ← bcrypt(agent_token), @Exclude() côté DTO
  shipper_kind  TEXT       ← docker | bash | php | cf-tail | browser
  shipper_ver   TEXT
  status        TEXT       ← pending | active | disabled
  last_seen     TIMESTAMPTZ
  created_at / updated_at

sources
  id           SERIAL PK
  agent_id     UUID FK → agents (CASCADE)
  type         TEXT       ← pm2 | cakephp | wordpress | prestashop | nginx | journald | docker | files
  config       JSONB      ← payload type-spécifique
  enabled      BOOL
  position     INT
  created_at / updated_at

config_versions
  id           SERIAL PK
  agent_id     UUID FK → agents (CASCADE)
  etag         TEXT       ← sha256(rendered).slice(16)
  rendered     JSONB      ← snapshot envoyé à l'agent
  created_at
```

## Flux : enrôlement + polling d'un shipper

```
1. Boot du shipper :
   - Lit /state/agent.json (Docker) ou /var/lib/wgr-shipper/agent.json (bash)
   - Si absent : POST /mgmt/agents/register avec WGR_REGISTER_TOKEN + hostname + shipper_kind
     → API génère un agent_token (256 bits hex), bcrypt-hash dans DB
     → Renvoie { agent_id, agent_token, status: 'pending' }
     → Shipper sauve { agent_id, agent_token } en local

2. Boucle de polling (toutes les 60s par défaut) :
   - GET /mgmt/agents/<agent_id>/config avec Bearer agent_token
     → API charge agent + sources, calcule ETag déterministe via renderer.service
     → Met à jour agent.last_seen
     → Si status=pending → passe à active
     → Renvoie { etag, rendered: { agent_id, env, cluster, host, sources: [...] } }
   - Shipper compare ETag avec celui local (state/last-etag)
   - Si différent :
     a. Transforme la réponse en sources.json compatible renderer
     b. Renderer émet config.alloy depuis les modules
     c. Sauve nouveau ETag
     d. kill -HUP alloy (Docker) ou systemctl reload alloy (bash)
```

## Flux : ingestion d'un log

```
Source (app, fichier, journald)
   │
   ▼
Alloy (sur le serveur où tournent les apps)
   │  pipeline : extract labels + extract level (JSON or stream-based)
   │  ajoute external_labels: { cluster: "wgr-prod" }
   ▼
loki.write `https://<INGEST_DOMAIN>/loki/api/v1/push` (BasicAuth wgr:INGEST_TOKEN)
   │
   ▼
Traefik → middleware cors-ingest + ingest-auth (ajoute X-Scope-OrgID)
   │
   ▼
Loki container (port 3100)
   │  validation, WAL local
   │  → chunks vers S3 toutes les ~30min
   │  → index TSDB local + sync S3
   ▼
Stocké, queryable via Grafana Explore ou /loki/api/v1/query_range
```

## Auth & rôles

```
                   role admin (UI desktop, Slack ops)
                   ──────────────────────────────────
                   token : WGR_API_ADMIN_TOKEN
                   accès : /mgmt/agents (R/W), /mgmt/agents/:id/sources (R/W),
                           /mgmt/source-types (R)

                   role agent (un shipper)
                   ───────────────────────
                   token : agent_token (par-agent, généré au register)
                   accès : /mgmt/agents/:id/config (R)
                           /mgmt/agents/:id/heartbeat (W)

                   role ingest (poussée de logs)
                   ─────────────────────────────
                   token : INGEST_AUTH_TOKEN (Basic auth)
                   accès : /loki/api/v1/push (W)

                   role register (création d'agents)
                   ─────────────────────────────────
                   token : WGR_API_REGISTER_TOKEN (one-time, partagé entre les ops)
                   accès : /mgmt/agents/register (W)
```

## Décisions de design notables

### Path-based API (`/mgmt`) au lieu de subdomain

`<API_DOMAIN>` était pris. Alternative subdomain (`agents.wgr.ch`, etc.) → 1 DNS de plus. Path `/mgmt` sur `<LOGS_DOMAIN>` est suffisamment unique pour ne pas collide avec Grafana (`/api/*`, `/d/*`, etc.). Router Traefik avec rule `Host && PathPrefix(/mgmt)` est naturellement plus spécifique que `Host()` alone donc gagne la priorité.

### ETag pour détecter les changements de config

L'API renvoie un ETag `sha256(rendered).slice(16)`. Déterministe (sources triées par `position` puis `id`). Le shipper compare avec son ETag local → ne reload que sur diff réel. Évite les reloads inutiles d'Alloy (qui sont gratuits mais bavards dans les logs).

### Renderer en bash + jq (pas Node, pas Python)

Le renderer du shipper Docker est en bash + jq. Pourquoi pas TypeScript ? Pour éviter une dépendance Node lourde dans l'image. L'image bash+jq fait 60MB vs ~200MB pour Node-alpine. Trade-off : la logique de templating est moins lisible mais reste sous 200 lignes.

### Mode managed avec fallback static

Tous les shippers (Docker + bash) supportent **les deux modes** :
- Managed (par défaut quand `WGR_API_URL` est défini) : polling
- Static (quand `WGR_API_URL` est absent et `sources.json` est présent) : render une fois, exec alloy

Le static est utile pour :
- Test sans API
- VPS qui ne peut pas atteindre l'API (firewall, mode dégradé)
- Bootstrap du VPS wgr-logs lui-même (chicken-egg)

### Pourquoi PHP pour le mutu

Sur un hébergement mutualisé Infomaniak :
- Pas de Docker
- Pas d'apt / sudo
- Pas de systemd
- Cron disponible
- PHP disponible (forcément, c'est un mutu PHP)

Donc le shipper PHP est lancé via cron toutes les 5 min, lit ses offsets dans un fichier, glob les sites, push en HTTP. Pas idéal pour la latence (5 min de delay), mais c'est le seul moyen.

### Pourquoi on dogfood le VPS wgr-logs

Le service `shipper` dans le compose racine fait le VPS son propre agent. Ça :
1. Valide que le mode managed marche en prod
2. Rend l'observabilité visible dans la UI desktop comme n'importe quel autre serveur
3. Sert d'exemple complet (compose, mounts, env)

## Limitations connues

- **Pas de migrations TypeORM** : on est en `synchronize: true` sur la DB. Acceptable car peu de données (~100 lignes max). Migrer si on atteint un volume sérieux.
- **Hostname du container** : le shipper Docker rapporte son hostname (= container ID) au register. On peut surcharger via `WGR_AGENT_NAME` ou via l'admin UI.
- **Pas de cluster mode pour Alloy** : un seul agent par serveur. Pas de problème vu la cible (PME, ~50 serveurs max).
- **Pas de retention par agent** : la retention est globale dans Loki (90 jours par défaut). Difficile de garder plus longtemps les logs d'un serveur critique sans tout garder.

## Voir aussi

- [`ROADMAP.md`](ROADMAP.md) — phases livrées + à venir
- [`api.md`](api.md) — référence des endpoints `/mgmt/*`
- [`runbook.md`](runbook.md) — incidents fréquents (Loki crash, cert expiré, etc.)
