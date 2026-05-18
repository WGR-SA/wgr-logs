# Runbook — common incidents

## Loki stops accepting pushes / 5xx on `/loki/api/v1/push`

1. `docker compose logs loki | tail -50` — check the error
2. Cause #1: expired S3 credentials → renew in `.env`, `docker compose up -d loki`
3. Cause #2: bucket full or blocked → check your S3 provider dashboard
4. Cause #3: corrupted WAL → `docker compose down loki && docker volume rm wgr-logs_loki-data && docker compose up -d loki` (loses logs in the WAL not yet flushed, ~30 min max)

## Grafana shows "No data" on all dashboards

1. From inside the Docker network: `curl http://loki:3100/ready` — should answer `ready`
2. Check the datasource: Settings → Data sources → Loki → Test
3. Verify the `app` label exists: Explore → `label_values(app)` should return active apps

## Alert doesn't fire despite the threshold

1. Grafana → Alerting → State history — see if the rule evaluated
2. Check `data` in the rule: does the Loki query actually return values?
3. Expired Slack webhook: regenerate in Slack admin → update `.env` → `docker compose up -d grafana`

## Disk volume full

Loki keeps the WAL locally (`loki-data`) + TSDB cache. Chunks go to S3.

```bash
docker system df
docker volume ls
du -sh /var/lib/docker/volumes/wgr-logs_loki-data
```

If it grows abnormally → increase `chunk_idle_period` or check the TSDB shipper actually uploads to S3 (`docker logs loki | grep tsdb-shipper`).

## Recover from a VPS crash

1. Re-provision the server (Debian + Docker + docker-compose)
2. `git clone` the repo
3. Restore `.env` from encrypted backup (1Password, etc.)
4. `docker compose up -d`
5. **Historical logs preserved** because they're on S3. Loki replays them automatically.

## DNS / SSL outage

Traefik retries ACME automatically. If it's stuck > 1h:
```bash
docker compose exec traefik cat /letsencrypt/acme.json | jq .
docker compose restart traefik
```

## Agent shows offline in the UI

1. Check `last_seen` timestamp on the agent
2. From the target server: `docker compose logs shipper --tail 50` (Docker) or `journalctl -u wgr-shipper-poll -n 50` (bash)
3. Common causes:
   - Network outage between target and `LOGS_DOMAIN`
   - Token corrupted in `/state/agent.json` or `/var/lib/wgr-shipper/agent.json` → re-enroll
   - Container/service stopped (check `docker compose ps` or `systemctl status`)

## Postgres database lost or corrupted

```bash
# Stop the API
docker compose stop api

# Restore from the latest daily backup
docker compose exec pg-backup ls -la /backups/daily/
docker compose exec pg psql -U wgrlogs -d wgr_logs < /backups/daily/wgr_logs-LATEST.sql.gz

# Restart
docker compose start api
```

Note: agents may need to re-enroll if their token_hash records were lost. Their `agent.json` will fail authentication → manually delete the file on each agent + re-run the installer/recreate the container.
