# wgr-logs-shipper

Docker image that collects logs from a server and ships them to a wgr-logs stack. Two modes:

- **Static** — config via a local `sources.json` file
- **Managed** — config fetched from the wgr-logs API (driven by the desktop UI, polled every 60s)

See [`../../docs/shipper-docker.md`](../../docs/shipper-docker.md) for the full guide.

## Managed mode (recommended)

See `examples/docker-compose.managed.yml`. In a nutshell:

```yaml
services:
  shipper:
    image: ghcr.io/wgr-sa/wgr-logs-shipper:latest
    environment:
      WGR_API_URL: https://<LOGS_DOMAIN>/mgmt
      WGR_INGEST_URL: https://<INGEST_DOMAIN>/loki/api/v1/push
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
      WGR_REGISTER_TOKEN: ${WGR_REGISTER_TOKEN}  # one-time, first boot only
    volumes:
      - shipper-state:/state   # IMPORTANT: persists agent_id
      - /var/log:/var/log:ro
      - /var/www:/var/www:ro
      - /run/log/journal:/run/log/journal:ro
volumes:
  shipper-state:
```

Flow:
1. First boot → `POST /mgmt/agents/register` with `WGR_REGISTER_TOKEN`
2. Receives permanent `agent_id` + `agent_token` → saves to `/state/agent.json`
3. `GET /mgmt/agents/<id>/config` every 60s
4. If ETag changed → regenerate `config.alloy` → `kill -HUP alloy` (native reload)

Manage sources via the desktop app → **Agents** tab → add/remove/edit sources → the agent applies within the minute.

## Static mode (no API)

```bash
mkdir -p /etc/wgr-logs && cd /etc/wgr-logs

# 1. Create config
cat > sources.json <<'EOF'
{
  "defaults": { "env": "prod", "host": "vps-pm2-01" },
  "sources": [
    { "type": "pm2", "path": "/var/log/pm2" },
    { "type": "nginx" },
    { "type": "journald" }
  ]
}
EOF

# 2. Compose
cat > docker-compose.yml <<'EOF'
services:
  shipper:
    image: ghcr.io/wgr-sa/wgr-logs-shipper:latest
    restart: always
    environment:
      WGR_INGEST_URL: https://<INGEST_DOMAIN>/loki/api/v1/push
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
    volumes:
      - ./sources.json:/config/sources.json:ro
      - /home/debian/.pm2/logs:/var/log/pm2:ro
      - /var/log/nginx:/var/log/nginx:ro
      - /run/log/journal:/run/log/journal:ro
      - /etc/machine-id:/etc/machine-id:ro
EOF

# 3. Token
echo "WGR_INGEST_TOKEN=<the_token>" > .env

# 4. Up
docker compose up -d
docker compose logs -f
```

## `sources.json` schema

```jsonc
{
  "defaults": {
    "env": "prod",                // prod | staging | dev
    "cluster": "prod",            // global tag
    "host": "vps-name"            // override hostname auto-detect
  },
  "sources": [
    { "type": "pm2",        "path": "/var/log/pm2" },
    { "type": "cakephp",    "base_dir": "/var/www" },
    { "type": "wordpress",  "base_dir": "/var/www" },
    { "type": "prestashop", "base_dir": "/var/www" },
    { "type": "nginx" },
    { "type": "journald" },
    { "type": "docker" },
    {
      "type": "files",
      "paths": ["/var/log/myapp/*.log"],
      "labels": { "app": "myapp", "component": "worker" }
    }
  ]
}
```

Each source can override `env` and `host` individually. See `packages/alloy-modules/schemas/source-types.json` for the full JSON schema.

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `WGR_INGEST_TOKEN` | ✅ | — | BasicAuth password for the Loki push endpoint |
| `WGR_INGEST_URL` | ✓ | — | Loki push URL |
| `WGR_INGEST_USER` | | `wgr` | BasicAuth username |
| `WGR_CONFIG_PATH` | | `/config/sources.json` | Mount path |
| `WGR_DEBUG` | | `0` | Set to `1` to dump the rendered config.alloy |

## Mounts per source type

| Source | Mount | Notes |
|---|---|---|
| `pm2` | `<host_pm2_logs>:<path>:ro` | The `sources[].path` must match the mount destination |
| `cakephp` / `wordpress` / `prestashop` | `<host_base_dir>:<base_dir>:ro` | Must match `sources[].base_dir` |
| `nginx` | `/var/log/nginx:/var/log/nginx:ro` | |
| `journald` | `/run/log/journal:/run/log/journal:ro` + `/etc/machine-id:/etc/machine-id:ro` | |
| `docker` | `/var/run/docker.sock:/var/run/docker.sock:ro` + `/var/lib/docker/containers:/var/lib/docker/containers:ro` | |
| `files` | One mount per declared path (read-only) | |

## Local build

```bash
# From the monorepo root
docker build -t wgr-logs-shipper:dev -f apps/wgr-logs-shipper/Dockerfile .
```

## Debug

```bash
# Inspect the rendered Alloy config
docker compose run --rm -e WGR_DEBUG=1 shipper

# Tail shipper logs
docker compose logs -f shipper
```

## Drop-in for an existing compose

See `examples/docker-compose.snippet.yml` for a block to paste into an existing compose without breaking anything. The shipper shares the network with other services (optional) and reads their log volumes.
