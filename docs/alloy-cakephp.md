# Brancher une appli CakePHP

CakePHP en bare metal (Apache/Nginx + PHP-FPM) → logs JSON dans `logs/` → Alloy tail → wgr-logs.

## 1. Configurer CakePHP pour logger en JSON

CakePHP 4.5+ et 5.x supportent les **formatters natifs**. Édite `config/app.php` (ou mieux : un fragment dans `app_local.php` selon ton setup).

```php
use Cake\Log\Engine\FileLog;
use Cake\Log\Formatter\JsonFormatter;

return [
    // ... reste de la config ...

    'Log' => [
        'error' => [
            'className' => FileLog::class,
            'path'      => LOGS,
            'file'      => 'error',
            'levels'    => ['warning', 'error', 'critical', 'alert', 'emergency'],
            'formatter' => [
                'className' => JsonFormatter::class,
                'context'   => true,        // inclut $context dans le JSON
                'flags'     => JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                'appendNewline' => true,    // une ligne par event
            ],
        ],
        'debug' => [
            'className' => FileLog::class,
            'path'      => LOGS,
            'file'      => 'debug',
            'levels'    => ['notice', 'info', 'debug'],
            'formatter' => [
                'className' => JsonFormatter::class,
                'context'   => true,
                'flags'     => JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                'appendNewline' => true,
            ],
        ],
    ],
];
```

Chaque ligne ressemblera à :
```json
{"date":"2026-05-18T11:23:45+00:00","level":"error","message":"Database connection lost","context":{"trace":"...","request_id":"abc-123"}}
```

Vérifie en local :
```bash
bin/cake server   # ou ton URL Apache habituelle
# Provoque une erreur, puis :
tail -n 5 logs/error.log
```

Tu dois voir du JSON, pas du texte CakePHP classique.

## 2. Install Alloy (Debian / Ubuntu) — sur le serveur CakePHP

```bash
sudo apt-get install -y wget gpg apt-transport-https acl
sudo mkdir -p /etc/apt/keyrings
wget -qO - https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
  | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt-get update
sudo apt-get install -y alloy
```

## 3. Env file avec token + métadonnées

```bash
sudo install -m 0600 /dev/stdin /etc/alloy/.env <<'EOF'
WGR_INGEST_TOKEN=colle_le_INGEST_AUTH_TOKEN_de_ton_.env_wgr-logs
CAKE_APP_NAME=cab-data
CAKE_LOGS_PATH=/var/www/cab-data/logs
CAKE_ENV=prod
EOF

sudo mkdir -p /etc/systemd/system/alloy.service.d
sudo tee /etc/systemd/system/alloy.service.d/env.conf >/dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/alloy/.env
EOF
sudo systemctl daemon-reload
```

Adapte :
- `CAKE_APP_NAME` → le slug de ton app (apparaîtra dans Grafana comme label `app`)
- `CAKE_LOGS_PATH` → le chemin absolu du dossier `logs/` de ton CakePHP
- `CAKE_ENV` → `prod`, `staging`, `dev`

## 4. ACL pour qu'Alloy lise les logs

Les logs CakePHP sont écrits par le user qui exécute PHP-FPM (`www-data` chez Debian/Ubuntu).

```bash
# Remplace le path si besoin
CAKE_LOGS=/var/www/cab-data/logs
sudo setfacl -m u:alloy:rx /var/www /var/www/cab-data
sudo setfacl -m u:alloy:rx "$CAKE_LOGS"
sudo setfacl -m u:alloy:r  "$CAKE_LOGS"/*.log 2>/dev/null || true
# Default ACL pour les futurs fichiers (rotation, nouveaux logs) :
sudo setfacl -d -m u:alloy:r "$CAKE_LOGS"
```

## 5. Déposer la config

```bash
# Depuis ton Mac, dans le repo wgr-logs :
scp -i ~/.ssh/<ta_cle> docker/alloy/cake-host.alloy <user>@<server>:/tmp/

# Sur le serveur CakePHP :
sudo install -m 0644 /tmp/cake-host.alloy /etc/alloy/config.alloy
```

## 6. Démarrer

```bash
sudo systemctl enable --now alloy
sudo systemctl status alloy --no-pager
journalctl -u alloy --since "1 min ago" | tail -30
```

À surveiller dans `journalctl` :
- ✅ `level=info msg="started component" ... loki.source.file`
- ✅ pas de `level=error`
- ❌ `permission denied` → retour étape 4 (ACL)
- ❌ `401`/`403` → token incorrect dans `/etc/alloy/.env`

## 7. Vérifier dans Grafana

`https://<LOGS_DOMAIN>` → Explore → datasource Loki → query :

```logql
{app="cab-data"}                                  # tous les logs de l'app
{app="cab-data", level="error"}                   # uniquement les erreurs
{app="cab-data"} | json | request_id != ""        # extraire un champ du JSON
{app="cab-data"} |~ "(?i)database"                # filtre texte
```

Le format JSON te permet de query sur n'importe quel champ via `| json | field=value`. Loki ne les indexe pas (pas de label) mais les filtre rapidement à la lecture.

## 8. Cas particuliers

### Plusieurs apps CakePHP sur le même serveur

Utilise `docker/alloy/cake-multi-host.alloy` à la place de `cake-host.alloy`. Il auto-découvre toutes les apps via un glob sur le dossier base :

```bash
# /etc/alloy/.env
WGR_INGEST_TOKEN=...
CAKE_BASE_DIR=/var/www     # toutes les apps sous /var/www/<slug>/logs/
CAKE_ENV=prod
```

Le label `app` est extrait du nom du dossier. Layout attendu :
```
/var/www/cab-data/logs/error.log     → app=cab-data
/var/www/ofrou-cms/logs/debug.log    → app=ofrou-cms
/var/www/family-affiche/logs/*.log   → app=family-affiche
```

Pour les ACL, donne accès à tout le `CAKE_BASE_DIR` plutôt qu'à un dossier précis :
```bash
sudo setfacl -R -m u:alloy:rX /var/www
sudo setfacl -d -R -m u:alloy:rX /var/www
```

Plusieurs bases (par exemple `/var/www` ET `/srv/apps`) : duplique les blocs `local.file_match` + `loki.source.file` dans la config Alloy avec des noms distincts.

### CakePHP 4.0–4.4 (pas de formatter natif)
Tu peux installer **Monolog** côté app + un handler personnalisé qui sérialise en JSON (`Monolog\Formatter\JsonFormatter`). Sinon migre vers 4.5+ qui a `Cake\Log\Formatter\JsonFormatter` natif.

### Logs rotation
CakePHP a un système de rotation interne basique via `rotate` dans la config FileLog. Alloy suit la rotation automatiquement (tail standard avec inode tracking).

### CLI tasks / cron CakePHP
Les `bin/cake` jobs écrivent dans `logs/cli-error.log` (ou similaire selon ton setup). Le tail inclut tous les `*.log` dans `CAKE_LOGS_PATH`, donc déjà couvert.

### Pile mixte (queries.log, audits.log…)
Le label `log_type` est extrait du nom du fichier, tu peux filtrer dans Grafana :
```logql
{app="cab-data", log_type="queries"}
```

## 9. Désinstaller

```bash
sudo systemctl disable --now alloy
sudo apt-get purge -y alloy
sudo rm -rf /etc/alloy /etc/systemd/system/alloy.service.d
```
