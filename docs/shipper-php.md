# Shipper PHP (hébergement mutualisé)

Pour les mutus type Infomaniak où on n'a ni Docker ni systemd ni root. Script PHP monofichier (`scripts/php-pusher/wgr-logs-push.php`) lancé via cron.

## Pré-requis

- PHP 7.4+ (ext `curl` + `json` — toujours dispo sur les mutus)
- Cron disponible (panneau Infomaniak ou crontab)
- Accès lecture aux logs des sites hébergés (par défaut OK car PHP cron tourne sous le même user que PHP-FPM)

## Install

```bash
# Sur ton mutu (SSH ou File Manager)
mkdir -p ~/wgr-logs/.state
cd ~/wgr-logs

# Récupère le script + l'exemple de config
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/wgr-logs-push.php
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/config.example.json
mv config.example.json config.json

# Édite config.json pour tes vrais paths
nano config.json
```

Variables à adapter dans `config.json` :
- `state_dir` : chemin absolu vers un dossier d'état (ex: `/home/clients/xxxxxx/wgr-logs/.state`)
- `defaults.host` : nom unique pour identifier ce mutu dans Grafana (ex: `mutu-infomaniak-01`)
- `sources[].glob` : tes vrais patterns

## Schéma `config.json`

```json
{
  "ingest": {
    "url": "https://<INGEST_DOMAIN>/loki/api/v1/push",
    "user": "wgr",
    "token_env": "WGR_INGEST_TOKEN"
  },
  "defaults": {
    "env": "prod",
    "cluster": "wgr-prod",
    "host": "mutu-infomaniak-01"
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

Le `app_from_path` est une regex PHP (délimiteur `#`) qui extrait le nom du site depuis le chemin du fichier — permet d'avoir un label `app=<site>` automatique.

## Token via env

Le token n'est jamais dans le JSON (gitignore-friendly). Il est lu depuis l'env `WGR_INGEST_TOKEN`. Selon ton hébergement :

**Option A** — Variables d'environnement Infomaniak (Panel → Hosting → PHP) :
```
WGR_INGEST_TOKEN=<INGEST_AUTH_TOKEN>
```

**Option B** — Prefix dans la commande cron :
```cron
*/5 * * * * WGR_INGEST_TOKEN=xxx /usr/bin/php /home/clients/.../wgr-logs/wgr-logs-push.php /home/clients/.../wgr-logs/config.json >> /dev/null 2>&1
```

## Cron Infomaniak

Dans le panel Infomaniak → Hosting → Cron jobs :
- **Commande** : `/usr/bin/php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json`
- **Fréquence** : Toutes les 5 minutes (`*/5 * * * *`)
- **Notification email** : Désactivée (sinon spam à chaque run)

## Test manuel

Avant le cron, lance à la main :

```bash
WGR_INGEST_TOKEN=xxx \
  php /home/clients/.../wgr-logs/wgr-logs-push.php \
      /home/clients/.../wgr-logs/config.json
echo "Exit: $?"
cat ~/wgr-logs/.state/last-run.json
```

`last-run.json` te donne le rapport :
```json
{
  "at": "2026-05-18T17:00:00+00:00",
  "host": "mutu-infomaniak-01",
  "lines_pushed": 142,
  "files_with_data": 8,
  "errors": []
}
```

Si `lines_pushed: 0` → vérifie que tes globs matchent :
```bash
ls /home/clients/*/sites/*/logs/
ls /home/clients/*/sites/*/app/tmp/logs/
```

## Vérifier dans Grafana

`https://<LOGS_DOMAIN>` → Explore → datasource Loki :

```logql
{host="mutu-infomaniak-01"}                          # tout le mutu
{host="mutu-infomaniak-01", app="mon-site"}          # un site précis
{host="mutu-infomaniak-01", framework="wordpress"}   # tous les WP
{host="mutu-infomaniak-01", source="cakephp3"}       # toutes les apps Cake 3+
```

## Comment ça marche en interne

1. **Lock** : `flock` sur `.state/.lock` pour ne pas overlapper si le cron précédent traîne
2. **Glob** : pour chaque source, `glob()` expand le pattern → liste de fichiers
3. **Offset** : `sha1(path)` → fichier d'état `.state/<hash>.offset` qui mémorise jusqu'où on a lu
4. **Lecture incrémentale** : `fseek()` à l'offset, lit les nouvelles lignes (cap 5000 par run)
5. **Rotation** : si la taille du fichier a diminué, reset à 0
6. **Push** : un POST HTTPS par fichier vers `<INGEST_DOMAIN>` (BasicAuth)
7. **Commit** : si le push retourne 2xx, l'offset pending devient l'offset committed. Sinon retry au prochain run.

## Limites

- **Latence min = intervalle cron** (5 min recommandé). Pour du temps réel, migre l'app sur un VPS avec le shipper Docker / bash.
- **Cap 5000 lignes/fichier/run** : évite OOM. Sur un site très bavard, augmenter la fréquence du cron ou ce cap.
- **Pas d'enrôlement managé** : le PHP cron n'apparaît **pas** dans l'UI Agents (il n'a pas d'agent_id, juste un `host` label). C'est volontaire — pas de daemon, pas de cycle de vie.
- **Pas de retry intelligent** : si Loki est down, les lignes sont oubliées jusqu'au prochain run (qui repart de la nouvelle position). Blackout long → rattrapage naturel.

## Désinstaller

```bash
# Retirer le cron via le panel Infomaniak
# Puis nettoyer
rm -rf ~/wgr-logs
```

Les logs déjà pushed restent sur Loki/S3. Le `host=mutu-…` n'apparaîtra plus en nouvel apport.

## Voir aussi

- [`api.md`](api.md) — la PHP cron NE PARLE PAS à l'API admin, juste Loki push direct
- [`shipper-docker.md`](shipper-docker.md), [`shipper-bash.md`](shipper-bash.md) — pour des serveurs avec plus de droits
