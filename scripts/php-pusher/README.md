# wgr-logs-push.php — PHP cron pusher

Single-file shipper for shared hosting environments where you can't run Docker, systemd, or sudo. Designed to run via cron every 1–5 minutes.

> **Full guide**: [`docs/shipper-php.md`](../../docs/shipper-php.md)

## Prerequisites

- PHP 7.4+ with `curl` + `json` extensions (always available on PHP hosts)
- Cron available (hosting panel or crontab)
- Read access to the hosted sites' logs (the PHP cron usually runs as the same user as PHP-FPM)

## Install

```bash
# On your shared host (SSH or File Manager)
mkdir -p ~/wgr-logs/.state
cd ~/wgr-logs

curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/wgr-logs-push.php
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/config.example.json
mv config.example.json config.json
nano config.json
```

Adjust at minimum:
- `ingest.url`: your `<INGEST_DOMAIN>` push endpoint
- `state_dir`: absolute path to a state dir
- `defaults.host`: unique name for this host
- `sources[].glob`: your real path patterns

## Cron

In the hosting panel:
- **Command**: `/usr/bin/php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json`
- **Frequency**: every 5 minutes (`*/5 * * * *`)
- **Email notifications**: disabled

## Token via env

```
WGR_INGEST_TOKEN=<INGEST_AUTH_TOKEN>
```

Set this in the hosting panel's PHP environment variables, OR prefix the cron command directly:

```cron
*/5 * * * * WGR_INGEST_TOKEN=xxx /usr/bin/php /home/.../wgr-logs-push.php /home/.../config.json >/dev/null 2>&1
```

## Manual test

```bash
WGR_INGEST_TOKEN=xxx php wgr-logs-push.php config.json
cat .state/last-run.json
```

See [`docs/shipper-php.md`](../../docs/shipper-php.md) for full details: schema, troubleshooting, internals.
