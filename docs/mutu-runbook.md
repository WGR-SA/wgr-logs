# Mutu runbook (Infomaniak shared hosting)

Operational steps for the PHP pusher already installed on the mutu — refresh
after a fix, and set up the cron from the Infomaniak Manager.

## 1. Refresh the pusher after a fix

When a new version of `wgr-logs-push.php` is pushed to `main`, pull it on the
mutu — no install, just overwrite the file.

```bash
# SSH into the mutu (uid188825@h2web287 in our case)
ssh uid188825@h2web287

cd ~/wgr-logs

# Backup current copy (optional, in case of regression)
cp wgr-logs-push.php wgr-logs-push.php.bak

# Pull latest
curl -fSO https://raw.githubusercontent.com/WGR-SA/wgr-logs/main/scripts/php-pusher/wgr-logs-push.php

# Sanity-check
php -l wgr-logs-push.php
```

`config.json` and `.state/` are **not** touched — offsets are preserved, the
next run resumes from where the previous left off.

### Re-run manually + check the report

```bash
# Load the token (already set in .env on the mutu)
set -a; source ~/wgr-logs/.env; set +a

php ~/wgr-logs/wgr-logs-push.php ~/wgr-logs/config.json
cat ~/wgr-logs/.state/last-run.json
```

What to check in `last-run.json`:
- `errors: []` → success
- `lines_pushed > 0` → new entries shipped
- `lines_pushed: 0` → either nothing new since last run, OR a glob mismatch
  (in that case verify with `ls /home/clients/*/sites/*/logs/`)

If a previous run left bad `errors`, re-running is safe — offsets are committed
only when the push returns 2xx, so failed files are retried automatically.

## 2. Wipe a specific host before re-import

If a flawed earlier run polluted Loki (e.g. all entries with `level=info`), delete
them from Loki before letting the cron back-fill:

```bash
# From your laptop, against the Loki API (admin port via SSH tunnel or direct)
curl -X POST -u "wgr:$INGEST_AUTH_TOKEN" \
  "https://<INGEST_DOMAIN>/loki/api/v1/delete?query=\{host=\"mutu-h2web287\"\}&start=2020-01-01T00:00:00Z&end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Loki marks the streams for deletion (`deletion_mode: filter-and-delete` in
`limits_config`); the compactor wipes them within 2h. Then reset the local
offsets on the mutu so files are re-read from start:

```bash
rm -rf ~/wgr-logs/.state/*.offset
```

## 3. Set up the cron from the Infomaniak Manager

The Infomaniak shared-hosting scheduler only accepts **URLs**, not scripts.
Solution : a tiny PHP wrapper (`cron-trigger.php`) lives in the public docroot
and shells out to the real pusher.

### Step 3.1 — Drop the wrapper in your docroot

```bash
# SSH on the mutu
ssh uid188825@h2web287

# Pick one of your sites' public_html — anyone will do (the script doesn't
# care which domain triggers it). Pick a low-traffic one to keep noise out
# of access logs.
cd ~/sites/<your-site>/public_html

curl -fSO https://raw.githubusercontent.com/WGR-SA/wgr-logs/main/scripts/php-pusher/cron-trigger.php
mv cron-trigger.php wgr-logs-cron.php
chmod 644 wgr-logs-cron.php
```

### Step 3.2 — Generate the secret URL token

```bash
# Open the .cron-token (no newline! `openssl rand -hex 24` produces a clean string)
openssl rand -hex 24 > ~/wgr-logs/.cron-token
chmod 600 ~/wgr-logs/.cron-token

cat ~/wgr-logs/.cron-token   # copy the value, you'll paste it in the cron URL
```

The wrapper reads this file on every request and refuses anything else with
HTTP 403 — anonymous probes don't trigger the pusher.

### Step 3.3 — Sanity-check the URL

```bash
TOKEN=$(cat ~/wgr-logs/.cron-token)
curl -sS "https://<your-site>/wgr-logs-cron.php?token=$TOKEN" | head -40
```

You should see :
```
exit=0 in 3.4s

--- stdout ---
…

--- last-run.json ---
{ "at": "...", "lines_pushed": ..., "errors": [] }
```

If you get `exit=1` or `wgr-logs dir not found`, edit `wgr-logs-cron.php` and
set `$WGR_LOGS_DIR` explicitly to the absolute path (`/home/clients/.../wgr-logs`).

### Step 3.4 — Add the cron in the Manager

1. Log into [manager.infomaniak.com](https://manager.infomaniak.com)
2. **Hébergement Web** → your hosting → **Tâches planifiées (cron)** → **Ajouter une tâche**
3. **Configuration** :
   - **Nom de la tâche** : `wgr-logs push`
   - **Activer la tâche** : ON
   - **URL à exécuter** :
     - protocol : `https`
     - URL : select your site domain
     - **Chemin du script** : `wgr-logs-cron.php?token=<paste the .cron-token value>`
   - **Cette URL est protégée par un mot de passe** : leave unchecked (our token query handles auth)
4. **Suivant** → **Fréquence** : every 5 minutes (`*/5 * * * *`)
5. **Suivant** → **Notifications** : email **disabled** (otherwise you get one every 5 min)
6. **Enregistrer**

⚠️ If your hosting tier supports it, prefer a **path-only URL** (no domain) —
this avoids public exposure entirely. Otherwise the wrapper's secret token is
your only line of defense, so don't paste it anywhere public.

## 4. Verify the cron is firing

```bash
# On the mutu
ls -la ~/wgr-logs/.state/last-run.json   # mtime should advance every 5 min
watch -n 30 'cat ~/wgr-logs/.state/last-run.json'

# If something looks wrong, hit the URL by hand to see stdout/stderr
TOKEN=$(cat ~/wgr-logs/.cron-token)
curl -sS "https://<your-site>/wgr-logs-cron.php?token=$TOKEN"
```

In Grafana → Explore (Loki) :

```logql
{host="mutu-h2web287"} | rate by (app) (5m)
```

Should show all sites pushing steadily.

## See also

- [`shipper-php.md`](shipper-php.md) — initial install guide
- [`log-formats.md`](log-formats.md) — multiline/level regex recipes per source type
