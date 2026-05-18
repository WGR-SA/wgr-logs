# PHP shipper (shared hosting)

For shared hosting environments (Infomaniak mutu, etc.) without Docker, systemd, or root access. A single-file PHP script (`scripts/php-pusher/wgr-logs-push.php`) runs via cron.

## Prerequisites

- PHP 7.4+ (with `curl` + `json` extensions — always available on PHP hosts)
- Cron available (hosting panel or crontab)
- Read access to the hosted sites' logs (PHP cron runs as the same user as PHP-FPM by default)

## Install

```bash
# On your shared host (SSH or File Manager)
mkdir -p ~/wgr-logs/.state
cd ~/wgr-logs

# Fetch the script + example config
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/wgr-logs-push.php
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/config.example.json
mv config.example.json config.json

# Edit config.json with your real paths
nano config.json
```

Variables to adapt in `config.json`:
- `ingest.url`: your `<INGEST_DOMAIN>` push endpoint
- `state_dir`: absolute path to a state directory (e.g. `/home/clients/xxxxxx/wgr-logs/.state`)
- `defaults.host`: unique name for this host in Grafana (e.g. `mutu-host-01`)
- `sources[].glob`: your real path patterns

## `config.json` schema

```json
{
  "ingest": {
    "url": "https://<INGEST_DOMAIN>/loki/api/v1/push",
    "user": "wgr",
    "token_env": "WGR_INGEST_TOKEN"
  },
  "defaults": {
    "env": "prod",
    "cluster": "prod",
    "host": "mutu-host-01"
  },
  "state_dir": "/home/clients/xxxxxx/wgr-logs/.state",
  "sources": [
    {
      "type": "cakephp2",
      "glob": "/home/clients/*/sites/*/app/tmp/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#",
      "labels": { "framework": "cakephp2" }
    },
    {
      "type": "cakephp3",
      "glob": "/home/clients/*/sites/*/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#",
      "labels": { "framework": "cakephp3" }
    },
    {
      "type": "wordpress",
      "glob": "/home/clients/*/sites/*/wp-content/debug.log",
      "app_from_path": "#/sites/([^/]+)/#",
      "labels": { "framework": "wordpress" }
    },
    {
      "type": "prestashop",
      "glob": "/home/clients/*/sites/*/var/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#",
      "labels": { "framework": "prestashop" }
    }
  ]
}
```

`app_from_path` is a PHP regex (`#` delimiter) that extracts the site name from the file path — gives you an automatic `app=<site>` label.

## Token via env

The token is never in the JSON (gitignore-friendly). It's read from the env `WGR_INGEST_TOKEN`. Depending on your host:

**Option A** — Environment variables in the hosting panel (Hosting → PHP → Environment variables):
```
WGR_INGEST_TOKEN=<INGEST_AUTH_TOKEN>
```

**Option B** — Prefix on the cron command:
```cron
*/5 * * * * WGR_INGEST_TOKEN=xxx /usr/bin/php /home/clients/.../wgr-logs/wgr-logs-push.php /home/clients/.../wgr-logs/config.json >> /dev/null 2>&1
```

## Cron

In the hosting panel → Hosting → Cron jobs:
- **Command**: `/usr/bin/php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json`
- **Frequency**: every 5 minutes (`*/5 * * * *`)
- **Email notifications**: disabled (otherwise spam on each run)

## Manual test

Before scheduling, run by hand:

```bash
WGR_INGEST_TOKEN=xxx \
  php /home/clients/.../wgr-logs/wgr-logs-push.php \
      /home/clients/.../wgr-logs/config.json
echo "Exit: $?"
cat ~/wgr-logs/.state/last-run.json
```

`last-run.json` gives you the report:
```json
{
  "at": "2026-05-18T17:00:00+00:00",
  "host": "mutu-host-01",
  "lines_pushed": 142,
  "files_with_data": 8,
  "errors": []
}
```

If `lines_pushed: 0` → check your globs match:
```bash
ls /home/clients/*/sites/*/logs/
ls /home/clients/*/sites/*/app/tmp/logs/
```

## Verify in Grafana

`https://<LOGS_DOMAIN>` → Explore → Loki datasource:

```logql
{host="mutu-host-01"}                          # all logs from this host
{host="mutu-host-01", app="my-site"}           # a specific site
{host="mutu-host-01", framework="wordpress"}   # all WP sites
{host="mutu-host-01", source="cakephp3"}       # all Cake 3+ apps
```

## How it works internally

1. **Lock**: `flock` on `.state/.lock` to avoid overlap if a previous cron is still running
2. **Glob**: for each source, `glob()` expands the pattern → list of files
3. **Offset**: `sha1(path)` → state file `.state/<hash>.offset` tracks where reading stopped
4. **Incremental read**: `fseek()` to offset, reads new lines (cap 5000 per run)
5. **Rotation**: if the file shrunk, reset to 0
6. **Push**: one HTTPS POST per file to `<INGEST_DOMAIN>` (BasicAuth)
7. **Commit**: if push returns 2xx, the pending offset becomes committed. Otherwise retry next run.

## Limits

- **Min latency = cron interval** (5 min recommended). For real-time, migrate the app to a VPS with the Docker/bash shipper.
- **Cap 5000 lines/file/run**: avoids OOM. On a noisy site, increase cron frequency or this cap.
- **No managed enrolment**: the PHP cron does **not** appear in the Agents UI (it has no agent_id, just a `host` label). Intentional — no daemon, no lifecycle.
- **No smart retry**: if Loki is down, lines are skipped until the next run (which restarts at the new position). Long blackout → natural catch-up.

## Uninstall

```bash
# Remove the cron via the hosting panel
# Then clean up
rm -rf ~/wgr-logs
```

Logs already pushed remain in Loki/S3. The `host=mutu-…` label won't get any new entries.

## See also

- [`api.md`](api.md) — note: the PHP cron does NOT talk to the admin API, only direct Loki push
- [`shipper-docker.md`](shipper-docker.md), [`shipper-bash.md`](shipper-bash.md) — for servers with more privileges
