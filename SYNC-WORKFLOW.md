# Sync workflow

Comment le code de ce repo atteint la prod.

## Vue d'ensemble

```
Local (Mac)  ──push main──►  GitHub  ──GH Actions──►  ghcr.io (images)
                                                  └►  SSH VPS (compose pull + up)
```

3 workflows :

| Workflow | Trigger | Effet |
|---|---|---|
| `build-shipper.yml` | push touchant `apps/wgr-logs-shipper/**` ou `packages/alloy-modules/**`, tag `shipper-v*` | Build + push `ghcr.io/wgr-sa/wgr-logs-shipper` (amd64+arm64) |
| `build-api.yml` | push touchant `apps/wgr-logs-api/**` ou `packages/alloy-modules/**`, tag `api-v*` | Build + push `ghcr.io/wgr-sa/wgr-logs-api` (amd64+arm64) |
| `deploy-stack.yml` | push touchant `docker-compose.yml`, `docker/**`, `scripts/deploy.sh` | SSH sur VPS → `docker compose pull && up -d` |
| `release-desk.yml` | tag `desk-v*` | Build Tauri matrix (macOS arm64+x64, Windows x64) → signed artifacts → GitHub release |

## Stack VPS

Push d'un commit qui modifie le compose ou un config → `deploy-stack.yml` SSH sur le VPS, fait `git pull` (le VPS a un clone du repo), `docker compose pull` puis `up -d`.

⚠️ Le VPS n'a **pas** de mise à jour de `.env` via le workflow — il faut le faire manuellement quand on ajoute une nouvelle env var :
```bash
scp -i ~/.ssh/wgr_logs .env debian@<VPS_IP>:~/wgr-logs/
ssh -i ~/.ssh/wgr_logs debian@<VPS_IP> 'cd ~/wgr-logs && docker compose up -d'
```

### Healthchecks post-deploy

Le workflow vérifie après le `up -d` :
- `curl /api/health` sur Grafana
- `curl /ready` sur Loki
- `curl /mgmt/health` sur l'API

Si l'un échoue, le workflow fail → on inspecte manuellement.

## Image shipper

Push touchant le shipper → CI build amd64+arm64 → push ghcr. Les serveurs cibles (Docker mode) qui font `docker compose pull` récupèrent la nouvelle version.

Mode managed : les agents redémarrent automatiquement avec la nouvelle image. Le `agent.json` est préservé via le volume `shipper-state`, pas de ré-enrôlement.

## Image API

Push touchant l'API → CI build → push ghcr → `deploy-stack.yml` (si compose changé en parallèle) pull + up. Si seule l'image change (pas le compose), il faut manuellement `docker compose pull api && up -d` sur le VPS, OU laisser le `deploy-stack` trigger via un faux commit sur le compose.

## Desktop app (`apps/wgr-logs-desk`)

1. Bump `version` dans `apps/wgr-logs-desk/package.json` et `src-tauri/tauri.conf.json`
2. Tag : `git tag desk-vX.Y.Z && git push --tags`
3. `release-desk.yml` build matrix (macOS arm64+x64, Windows x64) + signature minisign + GitHub Release
4. Existing installs auto-update via `tauri-plugin-updater` qui pointe sur le `latest.json` de la release

## Secrets requis

### GitHub repo secrets

| Secret | Usage |
|---|---|
| `SSH_PRIVATE_KEY` | Clé privée `wgr_logs` pour SSH sur le VPS (utilisée par `deploy-stack.yml`) |
| `SSH_HOST` | IP du VPS (`<VPS_IP>`) |
| `SSH_USER` | `debian` |
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key pour signer les builds Tauri |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password de la minisign key |
| `GITHUB_TOKEN` | Auto-fourni par GH, pour push ghcr |

### Côté VPS (`/home/debian/wgr-logs/.env`)

Voir `.env.example` à la racine du repo. Variables critiques :

| Var | Notes |
|---|---|
| `LOGS_DOMAIN` / `INGEST_DOMAIN` | Domaines Traefik |
| `LETSENCRYPT_EMAIL` | Email Let's Encrypt |
| `S3_*` | Credentials Infomaniak Swiss Backup |
| `INGEST_AUTH_TOKEN` | Basic auth Loki push |
| `GRAFANA_ADMIN_PASSWORD` | Admin Grafana (UI) |
| `PG_DATABASE_*` | Postgres pour l'API |
| `WGR_API_ADMIN_TOKEN` | Admin token pour l'UI desktop |
| `WGR_API_REGISTER_TOKEN` | Pour enrôler de nouveaux shippers |
| `SLACK_WEBHOOK_URL` | Pour les alertes Grafana |

### Côté serveurs cibles (shipper.env)

| Var | Notes |
|---|---|
| `WGR_INGEST_TOKEN` | = `INGEST_AUTH_TOKEN` côté VPS |
| `WGR_REGISTER_TOKEN` | = `WGR_API_REGISTER_TOKEN` côté VPS, one-time |

## Prod VPS

- Host: `debian@<VPS_IP>`
- SSH key: `~/.ssh/wgr_logs`
- Project path: `~/wgr-logs/`
- Reverse proxy: Traefik (own instance, port 80/443)

## Pre-flight checklist

Avant de merger une PR qui touche la stack :

- [ ] `.env.example` updated si nouvelle var
- [ ] Healthchecks passent localement (`docker compose ps` montre `healthy`)
- [ ] Provisionnement Grafana / API render OK
- [ ] Pas de secret committé (`git diff` review)
- [ ] Si nouvelle migration TypeORM nécessaire, créer manuellement (on est en `synchronize: true` pour l'instant)
- [ ] Si modif des modules Alloy, tester le rendu en local (`bash apps/wgr-logs-shipper/lib/render.sh ...`)

## Rollback

```bash
# Sur le VPS
cd ~/wgr-logs
git reset --hard <commit-sha-précédent>
docker compose pull
docker compose up -d --force-recreate
```

Si la DB Postgres a été cassée par un schéma, restaurer depuis `pg-backup` :
```bash
docker compose exec pg psql -U wgrlogs -d wgr_logs < /backups/daily/wgr_logs-YYYYMMDD.sql.gz
```
