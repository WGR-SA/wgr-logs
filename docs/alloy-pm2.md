# Brancher un serveur PM2

Install Alloy comme service systemd → tail des logs PM2 → push vers `<INGEST_DOMAIN>`.

## 1. Install Alloy (Debian / Ubuntu)

```bash
sudo apt-get install -y wget gpg apt-transport-https
sudo mkdir -p /etc/apt/keyrings
wget -qO - https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
  | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt-get update
sudo apt-get install -y alloy
```

## 2. Token d'ingestion via env file

```bash
sudo install -m 0600 /dev/stdin /etc/alloy/.env <<EOF
WGR_INGEST_TOKEN=<colle ici la valeur INGEST_AUTH_TOKEN du .env wgr-logs>
EOF
```

Brancher l'env file sur le service systemd :

```bash
sudo mkdir -p /etc/systemd/system/alloy.service.d
sudo tee /etc/systemd/system/alloy.service.d/env.conf >/dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/alloy/.env
EOF
sudo systemctl daemon-reload
```

## 3. Permissions sur les logs PM2

Alloy tourne sous l'user `alloy`. PM2 stocke ses logs sous `/home/<user>/.pm2/logs/` du user qui a `pm2 start`. Donne à `alloy` un accès lecture via ACL :

```bash
# Remplace <pm2_user> par le user qui exécute PM2 (souvent debian, ubuntu, ou root)
PM2_USER=<pm2_user>

sudo apt-get install -y acl
sudo setfacl -m u:alloy:rx /home/${PM2_USER} /home/${PM2_USER}/.pm2 /home/${PM2_USER}/.pm2/logs
sudo setfacl -m u:alloy:r /home/${PM2_USER}/.pm2/logs/*.log 2>/dev/null || true
# Default ACL pour les futurs fichiers crés par PM2 :
sudo setfacl -d -m u:alloy:r /home/${PM2_USER}/.pm2/logs
```

## 4. Déposer la config Alloy

Copier le fichier `docker/alloy/pm2-host.alloy` du repo wgr-logs sur le serveur :

```bash
# Depuis le repo wgr-logs (sur ton Mac) :
scp docker/alloy/pm2-host.alloy <pm2_user>@<server>:/tmp/

# Sur le serveur :
sudo install -m 0644 /tmp/pm2-host.alloy /etc/alloy/config.alloy
```

## 5. Démarrer

```bash
sudo systemctl enable --now alloy
sudo systemctl status alloy --no-pager
# Suivre les logs Alloy lui-même :
journalctl -u alloy -f
```

Pas d'erreur dans `journalctl` ? Continue.

## 6. Vérifier dans Grafana

Sur `https://<LOGS_DOMAIN>` → Explore → Datasource `Loki` → query :

```logql
{host="<hostname du serveur>"}
```

Tu dois voir les lignes apparaître. Pour filtrer une app :

```logql
{host="...", app="<nom du process PM2>"}
```

Si rien n'arrive :

```bash
# Sur le serveur PM2 :
sudo journalctl -u alloy --since "5 min ago" | grep -iE "error|fail"
# Tester la connectivité :
curl -u wgr:$(grep WGR_INGEST_TOKEN /etc/alloy/.env | cut -d= -f2) \
  https://<INGEST_DOMAIN>/ready
```

## 7. Cas particuliers

### PM2 sous Docker
Si l'app PM2 tourne **dans un container Docker**, c'est pas la peine d'installer Alloy : utilise le driver Docker Loki à la place (voir `connectors.md`).

### Plusieurs users PM2
Si plusieurs users sur la même machine ont des process PM2, répète l'étape 3 (`setfacl`) pour chaque.

### Logs JSON
Si l'app PM2 logue déjà en JSON (pino/winston), le label `level` est extrait du JSON automatiquement (voir la stage `stage.json` dans `pm2-host.alloy`). Sinon le `level` est dérivé du nom de fichier (`-error.log` → error, `-out.log` → info).

### Rotation des logs
PM2 a son propre log rotation via `pm2-logrotate` (`pm2 install pm2-logrotate`). Alloy suit la rotation grâce au tail standard. Aucune config supplémentaire.

## 8. Désinstaller / désactiver

```bash
sudo systemctl disable --now alloy
sudo apt-get purge -y alloy
```

Les logs déjà shipped vers Loki restent dans S3.
