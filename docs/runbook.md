# Runbook — incidents fréquents

## Loki ne pousse plus / 5xx sur `/loki/api/v1/push`

1. `docker compose logs loki | tail -50` — vérifier l'erreur
2. Cause #1 : credentials S3 expirés → renouveler dans `.env`, `docker compose up -d loki`
3. Cause #2 : bucket plein ou bloqué → check Infomaniak dashboard
4. Cause #3 : WAL corrompu → `docker compose down loki && docker volume rm wgr-logs_loki-wal && docker compose up -d loki` (perte des logs en WAL non encore flushés, ~30min max)

## Grafana montre "No data" sur tous les dashboards

1. `curl http://loki:3100/ready` depuis le réseau Docker — doit répondre `ready`
2. Vérifier la datasource : Settings → Data sources → Loki → Test
3. Vérifier que le label `app` existe : Explore → `label_values(app)` doit retourner les apps actives

## Alerte qui ne déclenche pas malgré le dépassement

1. Grafana → Alerting → State history — voir si la rule a évalué
2. Vérifier `data` dans la rule : la query Loki retourne-t-elle bien des valeurs ?
3. Slack webhook expirée : régénérer dans Slack admin → mettre à jour `.env` → `docker compose up -d grafana`

## Volume disque saturé

Loki garde le WAL local (`loki-wal`) + cache TSDB (`/loki/tsdb-cache`). Les chunks vont sur S3.

```bash
docker system df
docker volume ls
du -sh /var/lib/docker/volumes/wgr-logs_loki-wal
```

Si ça grossit anormalement → augmenter `chunk_idle_period` ou check que le shipper TSDB pousse bien sur S3 (`docker logs loki | grep tsdb-shipper`).

## Restaurer après crash VPS

1. Recréer le serveur (Debian + Docker + docker-compose).
2. `git clone` du repo.
3. Restaurer `.env` depuis backup chiffré (1Password).
4. `docker compose up -d`.
5. **Logs historiques préservés** car ils sont sur S3 Infomaniak. Loki les relit automatiquement.

## Coupure DNS / SSL

Traefik ré-essaie ACME automatiquement. Si ça bloque > 1h :
```bash
docker compose exec traefik cat /letsencrypt/acme.json | jq .
docker compose restart traefik
```
