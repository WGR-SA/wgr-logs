# wgr-logs-push.php — PHP cron pusher

Shipper monofichier pour hébergements mutualisés (Infomaniak, etc.) où on n'a ni Docker ni systemd ni accès root. Conçu pour être lancé via cron toutes les 1-5 minutes.

## Pré-requis

- PHP 7.4+
- Extension `curl` (toujours dispo sur les mutu PHP)
- Accès lecture aux logs des sites (les logs PHP-FPM tournent généralement sous le même user que le cron)
- Une commande cron dispo (panneau Infomaniak ou crontab)

## Installation

```bash
# Sur ton mutu via SSH ou File Manager
mkdir -p ~/wgr-logs/.state
cd ~/wgr-logs

# Récupère le script + l'exemple de config
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/wgr-logs-push.php
curl -O https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/php-pusher/config.example.json
mv config.example.json config.json

# Édite config.json pour mettre tes vrais paths
vi config.json
```

Adapte au minimum :
- `state_dir` : chemin absolu vers un dossier d'état (`~/wgr-logs/.state`)
- `defaults.host` : un nom unique pour identifier ce serveur dans Grafana
- `sources[].glob` : tes patterns réels (voir section ci-dessous)

## Patterns par techno (mutu Infomaniak typique)

```jsonc
// Layout standard /home/clients/<hash>/sites/<site>/...
{
  "sources": [
    { "type": "cakephp2",  "glob": "/home/clients/*/sites/*/app/tmp/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#" },
    { "type": "cakephp3",  "glob": "/home/clients/*/sites/*/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#" },
    { "type": "wordpress", "glob": "/home/clients/*/sites/*/wp-content/debug.log",
      "app_from_path": "#/sites/([^/]+)/#" },
    { "type": "prestashop","glob": "/home/clients/*/sites/*/var/logs/*.log",
      "app_from_path": "#/sites/([^/]+)/#" }
  ]
}
```

Le `app_from_path` est une regex PHP (délimiteur `#`) avec un groupe capturant qui extrait le nom du site depuis le chemin du fichier.

## Token d'ingestion

Le token doit être en variable d'environnement (pas dans le JSON, pour ne pas finir versionné). Sur Infomaniak panel → Hosting → PHP → Variables d'environnement :

```
WGR_INGEST_TOKEN=<le_token>
```

Ou si le panel ne le supporte pas, prefix dans la commande cron :

```cron
*/5 * * * * WGR_INGEST_TOKEN=xxx /usr/bin/php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json >> /dev/null 2>&1
```

## Cron Infomaniak

Dans le panel Infomaniak → Hosting → Cron jobs :
- **Commande** : `/usr/bin/php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json`
- **Fréquence** : Toutes les 5 minutes (`*/5 * * * *`)
- **Notification email** : Désactivée (sinon spam à chaque run)

## Test manuel

Avant de cronner, lance à la main :

```bash
WGR_INGEST_TOKEN=xxx php /home/clients/xxxxxx/wgr-logs/wgr-logs-push.php /home/clients/xxxxxx/wgr-logs/config.json
echo "Exit: $?"
cat ~/wgr-logs/.state/last-run.json
```

`last-run.json` te donne le rapport (lignes pushées, fichiers traités, erreurs). Si `lines_pushed: 0`, regarde si tes globs matchent (`ls /home/clients/*/sites/*/logs/`).

## Vérifier dans Grafana

`https://<LOGS_DOMAIN>` → Explore → datasource Loki :

```logql
{host="mutu-infomaniak-01"}                          // tout le mutu
{host="mutu-infomaniak-01", app="mon-site"}          // un site précis
{host="mutu-infomaniak-01", framework="wordpress"}   // tous les WP
{host="mutu-infomaniak-01", source="cakephp3"}       // toutes les apps Cake 3+
```

## Comment ça marche

1. **Lock** : `flock` sur `.state/.lock` pour ne pas overlapper si le cron précédent traîne
2. **Glob** : pour chaque source, `glob()` expand le pattern → liste de fichiers
3. **Offset** : `sha1(path)` → fichier d'état `.state/<hash>.offset` qui mémorise jusqu'où on a lu
4. **Lecture incrémentale** : `fseek()` à l'offset, lit les nouvelles lignes (cap 5000 par run)
5. **Rotation** : si la taille du fichier a diminué, reset à 0
6. **Push** : un POST HTTPS par fichier vers `<INGEST_DOMAIN>` (BasicAuth)
7. **Commit** : si le push retourne 2xx, l'offset pending devient l'offset committed. Sinon, on retry au prochain run.

## Limites connues

- **Pas de tail temps réel** : latence min = intervalle du cron (5 min recommandé). Pour du temps réel critique sur du PHP, déplace l'app sur un VPS avec le shipper Docker.
- **Cap 5000 lignes/fichier/run** : évite OOM. Sur un site très bavard, augmenter la fréquence du cron ou ce cap (variable hardcodée dans le script).
- **Pas de retry intelligent** : si Loki est down, les lignes sont oubliées jusqu'au prochain run (qui repartira de la nouvelle position). En cas de blackout long, le rattrapage se fait naturellement via le tail offset.

## Désinstaller

```bash
# Retirer le cron dans le panel Infomaniak
rm -rf ~/wgr-logs
```
