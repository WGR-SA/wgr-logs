# wgr-logs-shipper

Image Docker qui collecte les logs d'un serveur et les pousse vers wgr-logs. Configuration déclarative via un `sources.json` simple, modules Alloy générés automatiquement.

**Statut** : Phase A (mode static). La phase B ajoutera un mode "managed" qui poll la config depuis l'API wgr-logs.

## Quick start

```bash
mkdir -p /etc/wgr-logs && cd /etc/wgr-logs

# 1. Créer la config
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
      WGR_INGEST_TOKEN: ${WGR_INGEST_TOKEN}
    volumes:
      - ./sources.json:/config/sources.json:ro
      - /home/debian/.pm2/logs:/var/log/pm2:ro
      - /var/log/nginx:/var/log/nginx:ro
      - /run/log/journal:/run/log/journal:ro
      - /etc/machine-id:/etc/machine-id:ro
EOF

# 3. Token
echo "WGR_INGEST_TOKEN=<le_token>" > .env

# 4. Up
docker compose up -d
docker compose logs -f
```

## Schema `sources.json`

```jsonc
{
  "defaults": {
    "env": "prod",                    // prod | staging | dev
    "cluster": "wgr-prod",            // tag global
    "host": "vps-name"                // override hostname auto
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

Chaque source peut surcharger `env` et `host` individuellement (utile si un même shipper agrège plusieurs environnements). Voir `packages/alloy-modules/schemas/source-types.json` pour le JSON schema complet.

## Variables d'environnement

| Var | Required | Default | Rôle |
|---|---|---|---|
| `WGR_INGEST_TOKEN` | ✅ | — | BasicAuth password pour <INGEST_DOMAIN> |
| `WGR_INGEST_URL` | | `https://<INGEST_DOMAIN>/loki/api/v1/push` | URL Loki |
| `WGR_INGEST_USER` | | `wgr` | BasicAuth username |
| `WGR_CONFIG_PATH` | | `/config/sources.json` | Path mount |
| `WGR_DEBUG` | | `0` | Mettre à `1` pour dump le config.alloy rendu |

## Mounts requis par type de source

| Source | Mount obligatoire | Note |
|---|---|---|
| `pm2` | `<host_pm2_logs>:<path>:ro` | Le path doit matcher `sources[].path` |
| `cakephp` / `wordpress` / `prestashop` | `<host_base_dir>:<base_dir>:ro` | Doit matcher `sources[].base_dir` |
| `nginx` | `/var/log/nginx:/var/log/nginx:ro` | |
| `journald` | `/run/log/journal:/run/log/journal:ro` + `/etc/machine-id:/etc/machine-id:ro` | |
| `docker` | `/var/run/docker.sock:/var/run/docker.sock:ro` + `/var/lib/docker/containers:/var/lib/docker/containers:ro` | |
| `files` | un mount par path déclaré (read-only) | |

## Build local

```bash
# Depuis le monorepo root
docker build -t wgr-logs-shipper:dev -f apps/wgr-logs-shipper/Dockerfile .
```

## Debug

```bash
# Voir la config Alloy générée
docker compose run --rm -e WGR_DEBUG=1 shipper

# Tail logs du shipper
docker compose logs -f shipper
```

## Intégration dans un compose existant

Voir `examples/docker-compose.snippet.yml` pour le bloc à coller dans un compose existant sans rien casser. Le shipper partage le réseau avec les autres services (option), lit les logs via les volumes des autres services.
