# Docker shipper

Docker image `ghcr.io/wgr-sa/wgr-logs-shipper:latest` — runs Alloy on any VPS/server with Docker. Multi-arch (amd64 + arm64).

## Modes

| Mode | Trigger | Use case |
|---|---|---|
| **Managed** ⭐ | `WGR_API_URL` env set | Recommended — config driven from the desktop UI |
| **Static** | `/config/sources.json` mounted + no `WGR_API_URL` | Simple setups / debug / degraded mode |

## Managed mode (recommended)

Ready-to-use compose: `apps/wgr-logs-shipper/examples/docker-compose.managed.yml`.

### Setup

```bash
# On the target server
mkdir -p /etc/wgr-logs && cd /etc/wgr-logs

cat > .env <<'EOF'
WGR_INGEST_TOKEN=<INGEST_AUTH_TOKEN>
WGR_REGISTER_TOKEN=<WGR_API_REGISTER_TOKEN>
EOF
chmod 600 .env

cat > docker-compose.yml <<'EOF'
services:
  shipper:
    image: ghcr.io/wgr-sa/wgr-logs-shipper:latest
    restart: always
    environment:
      WGR_API_URL: https://<LOGS_DOMAIN>/mgmt
      WGR_INGEST_URL: https://<INGEST_DOMAIN>/loki/api/v1/push
      WGR_INGEST_USER: wgr
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
      WGR_REGISTER_TOKEN: ${WGR_REGISTER_TOKEN}
      WGR_AGENT_NAME: vps-pm2-01      # optional, defaults to hostname
      WGR_POLL_INTERVAL: "60"
    volumes:
      - shipper-state:/state          # IMPORTANT: persists agent_id + agent_token
      - /home/debian/.pm2/logs:/var/log/pm2:ro
      - /var/www:/var/www:ro
      - /var/log/nginx:/var/log/nginx:ro
      - /var/log/journal:/run/log/journal:ro   # adjust to host journal path
      - /etc/machine-id:/etc/machine-id:ro

volumes:
  shipper-state:
EOF

docker compose up -d
docker compose logs -f
```

### First boot

1. The shipper auto-enrolls via `POST /mgmt/agents/register`
2. Gets a permanent `agent_id` + `agent_token` → saves to `/state/agent.json`
3. The agent shows up in the desktop app with `status=pending`
4. After the first config poll (~60s), status → `active`
5. Add sources via the desktop UI → the agent applies them within 60s

### Live flow

```
every 60s:
  shipper → GET /mgmt/agents/<id>/config (Bearer agent_token)
             ← ETag + rendered config
  
  if ETag changed:
    shipper → render config.alloy from modules
    shipper → kill -HUP $(pidof alloy)    (Alloy native reload)
```

### Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `WGR_API_URL` | ✓ | — | Presence triggers managed mode |
| `WGR_INGEST_URL` | ✓ | — | `https://<INGEST_DOMAIN>/loki/api/v1/push` |
| `WGR_INGEST_USER` | | `wgr` | BasicAuth username |
| `WGR_INGEST_TOKEN` | ✓ | — | BasicAuth password (used by Alloy via `loki.write.basic_auth`) |
| `WGR_REGISTER_TOKEN` | ✓ first boot | — | Not needed after enrolment |
| `WGR_AGENT_NAME` | | hostname | Display name in the UI |
| `WGR_POLL_INTERVAL` | | `60` | Seconds |
| `WGR_STATE_DIR` | | `/state` | Must be a persistent volume! |
| `WGR_DEBUG` | | `0` | Set to `1` to dump rendered config.alloy at boot |

### Mounts per source type

Sources are declared via the UI, but the container must be able to read the relevant paths. Mount **read-only** the paths you'll likely use:

| Source | Mount | Notes |
|---|---|---|
| `pm2` | `/home/<user>/.pm2/logs:/var/log/pm2:ro` | `config.path` must match the mount destination |
| `cakephp` | `/var/www:/var/www:ro` | Globs `/var/www/<app>/logs` |
| `wordpress` | `/var/www:/var/www:ro` | Globs `<site>/wp-content/debug.log` |
| `prestashop` | `/var/www:/var/www:ro` | Globs `<site>/var/logs/*` |
| `nginx` | `/var/log/nginx:/var/log/nginx:ro` | Conventional path |
| `journald` | `/var/log/journal:/run/log/journal:ro` + `/etc/machine-id:/etc/machine-id:ro` | On Debian/Ubuntu with persistent journal. Volatile: `/run/log/journal:/run/log/journal:ro` |
| `docker` | `/var/run/docker.sock:/var/run/docker.sock:ro` + `/var/lib/docker/containers:/var/lib/docker/containers:ro` | Tails the host's other containers |
| `files` | Mount the path declared in `paths` | |

⚠️ Mounts are **not hot** — if you add a source type via the UI after boot and its path isn't mounted, the agent can't access it. Mount broadly upfront.

## Static mode (no API)

For simple setups / debug / when the API is unreachable.

```yaml
services:
  shipper:
    image: ghcr.io/wgr-sa/wgr-logs-shipper:latest
    restart: always
    environment:
      WGR_INGEST_URL: https://<INGEST_DOMAIN>/loki/api/v1/push
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
      # No WGR_API_URL ↑ → static mode
    volumes:
      - ./sources.json:/config/sources.json:ro
      - /var/log:/var/log:ro
      # ... per-source mounts ...
```

`sources.json`:
```json
{
  "defaults": { "env": "prod", "host": "vps-pm2-01" },
  "sources": [
    { "type": "pm2", "path": "/var/log/pm2" },
    { "type": "nginx" }
  ]
}
```

No polling, no enrolment. Edit `sources.json` → `docker compose restart shipper`.

## Integrate into an existing compose

See `apps/wgr-logs-shipper/examples/docker-compose.snippet.yml` — block to paste into an existing compose. The shipper observes other containers via the Docker socket, sharing log volumes.

## Local build (for iteration)

```bash
# From the monorepo root
docker build -t wgr-logs-shipper:dev -f apps/wgr-logs-shipper/Dockerfile .
```

## Uninstall

```bash
docker compose down -v   # -v also removes the shipper-state volume
```

The agent stays in the API DB (status will turn offline). Remove permanently via the desktop UI.

## Debug

| Symptom | Likely cause |
|---|---|
| Container restart loop, "unhealthy" | Healthcheck targets the wrong path. Check `compose ps` + `compose logs shipper` |
| Enrolment fails, 401 | Invalid `WGR_REGISTER_TOKEN`. Regenerate from the wgr-logs server `.env` |
| Enrolled but no logs in Loki | Source added but path not mounted in the compose |
| journald = 0 events | Wrong journal mount path (volatile vs persistent). On Debian/Ubuntu: `/var/log/journal:/run/log/journal:ro` |
| Reload doesn't happen | Check `docker logs shipper | grep reload` |

## See also

- [`api.md`](api.md) — endpoints used by the shipper
- [`shipper-bash.md`](shipper-bash.md) — Docker-less alternative
- [`architecture.md`](architecture.md) — full diagram
