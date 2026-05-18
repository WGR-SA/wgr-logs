# wgr-logs architecture

Overview of the stack, components, flows, and design decisions.

## Topology

```
┌─────────────────────────── VPS (your domain) ──────────────────────────────┐
│                                                                            │
│  Internet ──443──► Traefik v2.11 ─┬─► Grafana (LOGS_DOMAIN root)           │
│                                   ├─► API     (LOGS_DOMAIN/mgmt)          │
│                                   └─► Loki    (INGEST_DOMAIN)             │
│                                                                            │
│              Docker network `wgr-logs`                                     │
│                                                                            │
│   ┌──────────────────────────────────┐  ┌─────────────────────┐            │
│   │ Loki 3.2                         │  │ Postgres 16         │            │
│   │   chunks → S3 (sovereign)        │  │ + pg-backup daily   │            │
│   │   ruler  → S3                    │  └──────────┬──────────┘            │
│   │   WAL    → loki-data volume      │             │                       │
│   └──────────────────────────────────┘             │                       │
│                                                    │                       │
│                                       ┌────────────┴────────────┐          │
│                                       │  wgr-logs-api (NestJS)  │          │
│                                       │   /mgmt/agents/*        │          │
│                                       │   /mgmt/source-types    │          │
│                                       │   /mgmt/health          │          │
│                                       └─────────────────────────┘          │
│                                                                            │
│   ┌──────────────────────────────────┐                                     │
│   │ shipper (dogfood, managed mode)  │ ← reads journald + nginx from host  │
│   └──────────────────────────────────┘                                     │
└────────────────────────────────────────────────────────────────────────────┘
              ▲                                          ▲
  ingest push │                          poll + heartbeat│
              │                                          │
  ┌───────────┴───────┐  ┌──────────────────┐  ┌─────────┴──────────┐
  │ Docker shipper    │  │ Bash installer   │  │ PHP cron           │
  │  (multi-arch ghcr)│  │  (Alloy+systemd) │  │  (shared hosting)  │
  └───────────────────┘  └──────────────────┘  └────────────────────┘

  ┌─────────────────────┐
  │ wgr-logs-desk       │  Bearer admin_token
  │ (Nuxt 4 + Tauri 2)  │  ─────────────────► LOGS_DOMAIN/mgmt
  │  Dashboard / Live / │
  │  Search / Alerts /  │
  │  Agents             │
  └─────────────────────┘
```

## Docker services (root compose)

| Service | Image | Volumes | Purpose |
|---|---|---|---|
| `traefik` | traefik:v2.11 | `traefik-letsencrypt` | TLS via Let's Encrypt + reverse proxy with CORS middlewares |
| `loki` | grafana/loki:3.2 | `loki-data` | Log ingestion, chunks to S3 |
| `grafana` | grafana/grafana-oss:11.3 | `grafana-data` | Dashboards, Explore, Alerting (provisioned from `docker/grafana/`) |
| `pg` | postgres:16-alpine | `pg-data` | API database |
| `pg-backup` | prodrigestivill/postgres-backup-local:16 | `pg-backups` | Daily dump, 7d/4w/3m retention |
| `api` | ghcr.io/wgr-sa/wgr-logs-api:latest | — | NestJS, exposes `/mgmt/*` |
| `shipper` | ghcr.io/wgr-sa/wgr-logs-shipper:latest | `shipper-state` + host mounts | Dogfood: the VPS is its own managed agent |

## Storage

- **Loki chunks** (compressed logs) → S3 bucket `*-chunks`
- **Loki ruler** (alert rules) → S3 bucket `*-ruler`
- **Loki WAL** (write-ahead log, ~30 min buffer) → Docker volume `loki-data`
- **Postgres** (agents, sources, config_versions) → Docker volume `pg-data`
- **Daily pg dumps** → Docker volume `pg-backups`
- **Grafana** (persisted dashboards, plugins) → Docker volume `grafana-data`

## Postgres schema (managed by TypeORM)

```sql
agents
  id            UUID PK
  name          TEXT
  hostname      TEXT
  env           TEXT (default 'prod')
  cluster       TEXT
  token_hash    TEXT       ← bcrypt(agent_token), @Exclude()d from DTOs
  shipper_kind  TEXT       ← docker | bash | php | cf-tail | browser
  shipper_ver   TEXT
  status        TEXT       ← pending | active | disabled
  last_seen     TIMESTAMPTZ
  created_at / updated_at

sources
  id           SERIAL PK
  agent_id     UUID FK → agents (CASCADE)
  type         TEXT       ← pm2 | cakephp | wordpress | prestashop | nginx | journald | docker | files
  config       JSONB      ← type-specific payload, validated against JSON schemas
  enabled      BOOL
  position     INT
  created_at / updated_at

config_versions
  id           SERIAL PK
  agent_id     UUID FK → agents (CASCADE)
  etag         TEXT       ← sha256(rendered).slice(16)
  rendered     JSONB      ← snapshot sent to the agent (audit trail)
  created_at
```

## Flow: shipper enrollment + polling

```
1. Shipper boot:
   - Reads /state/agent.json (Docker) or /var/lib/wgr-shipper/agent.json (bash)
   - If missing: POST /mgmt/agents/register with WGR_REGISTER_TOKEN + hostname + shipper_kind
     → API generates an agent_token (256-bit hex), bcrypt-hashed in DB
     → Returns { agent_id, agent_token, status: 'pending' }
     → Shipper persists locally

2. Polling loop (default 60s):
   - GET /mgmt/agents/<agent_id>/config with Bearer agent_token
     → API loads agent + sources, computes deterministic ETag via renderer.service
     → Updates agent.last_seen
     → If status=pending → moves to active
     → Returns { etag, rendered: { agent_id, env, cluster, host, sources: [...] } }
   - Shipper compares ETag with local one (state/last-etag)
   - If different:
     a. Transforms response into a sources.json compatible with the renderer
     b. Renderer emits config.alloy from the modules
     c. Saves new ETag
     d. kill -HUP alloy (Docker) or systemctl reload alloy (bash)
```

## Flow: log ingestion

```
Source (app, file, journald)
   │
   ▼
Alloy (running on the source server)
   │  pipeline: extract labels + level (JSON or stream-based)
   │  adds external_labels: { cluster: "prod" }
   ▼
loki.write `https://<INGEST_DOMAIN>/loki/api/v1/push` (BasicAuth wgr:INGEST_TOKEN)
   │
   ▼
Traefik → middleware cors-ingest + ingest-auth (adds X-Scope-OrgID)
   │
   ▼
Loki container (port 3100)
   │  validates, writes to WAL
   │  → flushes chunks to S3 every ~30 min
   │  → local TSDB index + sync to S3
   ▼
Stored, queryable via Grafana Explore or /loki/api/v1/query_range
```

## Auth & roles

```
admin role (desktop UI, ops)
─────────────────────────────
token : WGR_API_ADMIN_TOKEN
scope : /mgmt/agents (R/W), /mgmt/agents/:id/sources (R/W),
        /mgmt/source-types (R)

agent role (a shipper)
──────────────────────
token : agent_token (per-agent, generated at register)
scope : /mgmt/agents/:id/config (R)
        /mgmt/agents/:id/heartbeat (W)

ingest role (push logs)
────────────────────────
token : INGEST_AUTH_TOKEN (Basic auth)
scope : /loki/api/v1/push (W)

register role (create new agents)
─────────────────────────────────
token : WGR_API_REGISTER_TOKEN (shared across ops)
scope : /mgmt/agents/register (W, one-time per agent)
```

## Notable design decisions

### Path-based API (`/mgmt`) instead of subdomain

We host the API on `LOGS_DOMAIN/mgmt` rather than a separate subdomain to avoid managing yet another DNS record. The Traefik rule `Host && PathPrefix(/mgmt)` is naturally more specific than the Grafana `Host()` alone, so it wins the priority automatically. Grafana's own `/api/*` paths are unaffected.

### ETag for change detection

The API returns an ETag `sha256(rendered).slice(16)`. Deterministic (sources sorted by `position` then `id`). The shipper compares with its local ETag → only reloads on real diffs. Avoids unnecessary Alloy reloads (which are free but noisy in logs).

### Renderer in bash + jq (not Node, not Python)

The Docker shipper renderer is bash + jq. Why not TypeScript? To avoid a heavy Node dependency in the image. bash+jq image is ~60 MB vs ~200 MB for Node-alpine. Trade-off: templating logic is less readable but stays under 200 lines.

### Managed mode with static fallback

All shippers (Docker + bash) support **both modes**:
- Managed (default when `WGR_API_URL` is set): polling
- Static (when `WGR_API_URL` is absent and `sources.json` is present): render once, exec alloy

Static is useful for:
- Testing without an API
- VPS that can't reach the API (firewall, degraded mode)
- Bootstrapping the wgr-logs VPS itself (chicken-egg)

### Why PHP for shared hosting

On a shared host (Infomaniak mutu, etc.):
- No Docker
- No apt / sudo
- No systemd
- Cron is available
- PHP is available (it's a PHP hosting)

So the PHP shipper runs via cron every 5 min, tracks offsets in a file, globs sites, pushes via HTTP. Not ideal latency (5 min delay) but it's the only viable approach.

### Why dogfood the VPS

The `shipper` service in the root compose makes the VPS its own agent. This:
1. Validates managed mode in production
2. Makes the VPS observability visible in the desktop UI like any other server
3. Serves as a complete example (compose, mounts, env)

## Known limitations

- **No TypeORM migrations** yet: `synchronize: true` is fine for low-data scenarios (~100 rows). Migrate if volume grows.
- **Container hostname**: the Docker shipper reports its hostname (= container ID) at register. Override via `WGR_AGENT_NAME` or via the admin UI.
- **No Alloy cluster mode**: one agent per server. Fine for the target (SME, ~50 servers max).
- **No per-agent retention**: retention is global in Loki (90 days by default). Hard to keep one server's logs longer than the rest without keeping everything.

## See also

- [`ROADMAP.md`](ROADMAP.md) — shipped phases + planned
- [`api.md`](api.md) — `/mgmt/*` endpoints reference
- [`runbook.md`](runbook.md) — common incidents
