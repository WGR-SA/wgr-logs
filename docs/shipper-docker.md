# Shipper Docker

Image Docker `ghcr.io/wgr-sa/wgr-logs-shipper:latest` — fait tourner Alloy sur n'importe quel VPS/serveur avec Docker. Multi-arch (amd64 + arm64).

## Modes

| Mode | Trigger | Use case |
|---|---|---|
| **Managed** ⭐ | `WGR_API_URL` env défini | Recommandé — config pilotée depuis l'UI desktop |
| **Static** | `/config/sources.json` mounté + pas de `WGR_API_URL` | Setups simples / debug / mode dégradé |

## Mode Managed (recommandé)

Compose ready-to-use : voir `apps/wgr-logs-shipper/examples/docker-compose.managed.yml`.

### Setup

```bash
# Sur le serveur cible
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
      WGR_AGENT_NAME: vps-pm2-01      # optionnel, hostname par défaut
      WGR_POLL_INTERVAL: "60"
    volumes:
      - shipper-state:/state          # IMPORTANT: persiste agent_id + agent_token
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

### Premier démarrage

1. Le shipper s'enrôle automatiquement via `POST /mgmt/agents/register`
2. Reçoit un `agent_id` + `agent_token` permanent → sauve dans `/state/agent.json`
3. L'agent apparaît dans l'app desktop avec status=pending
4. Au premier poll de config (60s max), status passe à `active`
5. À toi d'ajouter des sources dans l'UI desktop → l'agent les applique dans 60s max

### Flow live

```
toutes les 60s :
  shipper → GET /mgmt/agents/<id>/config (Bearer agent_token)
             ← ETag + rendered config
  
  si ETag changé :
    shipper → render config.alloy depuis les modules
    shipper → kill -HUP $(pidof alloy)    (reload natif Alloy)
```

### Variables d'env

| Var | Required | Default | Notes |
|---|---|---|---|
| `WGR_API_URL` | ✓ | — | Présence active le managed mode |
| `WGR_INGEST_URL` | ✓ | `https://<INGEST_DOMAIN>/loki/api/v1/push` | |
| `WGR_INGEST_USER` | | `wgr` | BasicAuth username |
| `WGR_INGEST_TOKEN` | ✓ | — | BasicAuth password (le shipper s'en sert dans Alloy via `loki.write.basic_auth`) |
| `WGR_REGISTER_TOKEN` | ✓ first boot | — | Plus nécessaire après enrôlement |
| `WGR_AGENT_NAME` | | hostname | Nom affiché dans l'UI |
| `WGR_POLL_INTERVAL` | | `60` | Secondes |
| `WGR_STATE_DIR` | | `/state` | Doit être un volume persistant ! |
| `WGR_DEBUG` | | `0` | À `1` pour dumper le config.alloy au boot |

### Mounts par type de source

Les sources sont déclarées via l'UI, mais le container doit pouvoir lire les paths concernés. Mount **read-only** les paths que tu prévois d'utiliser :

| Source | Mount | Notes |
|---|---|---|
| `pm2` | `/home/<user>/.pm2/logs:/var/log/pm2:ro` | Le path dans `config.path` doit matcher la destination du mount |
| `cakephp` | `/var/www:/var/www:ro` | Glob `/var/www/<app>/logs` |
| `wordpress` | `/var/www:/var/www:ro` | Glob `<site>/wp-content/debug.log` |
| `prestashop` | `/var/www:/var/www:ro` | Glob `<site>/var/logs/*` |
| `nginx` | `/var/log/nginx:/var/log/nginx:ro` | Conventionnel |
| `journald` | `/var/log/journal:/run/log/journal:ro` + `/etc/machine-id:/etc/machine-id:ro` | Sur Debian/Ubuntu avec journal persistant. Si volatile : `/run/log/journal:/run/log/journal:ro`. |
| `docker` | `/var/run/docker.sock:/var/run/docker.sock:ro` + `/var/lib/docker/containers:/var/lib/docker/containers:ro` | Permet de tailer les containers du même host |
| `files` | À toi de mounter le path déclaré dans `paths` | |

⚠️ Les mounts ne sont **pas hot** — si tu ajoutes un type de source dans l'UI après le démarrage, et que le path n'est pas mounté, l'agent ne pourra pas y accéder. Mount large dès le départ.

## Mode Static (sans API)

Pour setups simples / debug / sans API joignable.

```yaml
services:
  shipper:
    image: ghcr.io/wgr-sa/wgr-logs-shipper:latest
    restart: always
    environment:
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
      # Pas de WGR_API_URL ↑ → mode static
    volumes:
      - ./sources.json:/config/sources.json:ro
      - /var/log:/var/log:ro
      # ... mounts par source ...
```

`sources.json` :
```json
{
  "defaults": { "env": "prod", "host": "vps-pm2-01" },
  "sources": [
    { "type": "pm2", "path": "/var/log/pm2" },
    { "type": "nginx" }
  ]
}
```

Pas de polling, pas d'enrôlement. Modif du `sources.json` → `docker compose restart shipper`.

## Intégrer dans un compose existant

Voir `apps/wgr-logs-shipper/examples/docker-compose.snippet.yml` — bloc à coller dans un compose existant. Le shipper observe les autres containers via le socket Docker, partage les volumes des logs.

## Build local (pour itérer)

```bash
# Depuis la racine du monorepo
docker build -t wgr-logs-shipper:dev -f apps/wgr-logs-shipper/Dockerfile .
```

## Désinstaller

```bash
docker compose down -v   # -v pour aussi virer le volume shipper-state
```

L'agent reste dans la DB côté API (status va passer à offline). Pour le retirer définitivement : supprimer via l'UI desktop.

## Debug

| Symptôme | Cause probable |
|---|---|
| Container en restart loop, "unhealthy" | Healthcheck pointe sur un mauvais path. Vérifier `compose ps` + `compose logs shipper` |
| Pas d'enrôlement, 401 | `WGR_REGISTER_TOKEN` invalide. Régénérer depuis le `.env` du serveur wgr-logs |
| Enrôlé mais pas de logs dans Loki | Source ajoutée mais path non mounté dans le compose |
| journald = 0 events | Mount du journal pointe sur le mauvais chemin (volatile vs persistent). Sur Debian/Ubuntu : `/var/log/journal:/run/log/journal:ro` |
| Reload ne se fait pas | Pas d'erreur visible, juste vérifier `docker logs shipper | grep reload` |

## Voir aussi

- [`api.md`](api.md) — référence des endpoints utilisés
- [`shipper-bash.md`](shipper-bash.md) — alternative sans Docker
- [`architecture.md`](architecture.md) — schéma complet
