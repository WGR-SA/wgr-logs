# Shipper bash (Linux sans Docker)

Pour les VPS Debian/Ubuntu avec accès root mais sans Docker. Le script `scripts/install-shipper.sh` est self-contained — il embarque les 9 modules Alloy + le renderer, et s'installe via `curl | sudo bash`.

## Pré-requis

- Debian / Ubuntu avec systemd (testé Debian 12, devrait marcher Ubuntu 22+)
- Accès root (sudo)
- Network sortant (apt, ghcr, <LOGS_DOMAIN>)

## Install one-liner (managed mode)

```bash
INGEST=<INGEST_AUTH_TOKEN>      # le token de ton .env wgr-logs
REGISTER=<WGR_API_REGISTER_TOKEN>

curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
  | sudo bash -s -- \
      --api-url https://<LOGS_DOMAIN>/mgmt \
      --register-token "$REGISTER" \
      --ingest-token "$INGEST" \
      --name $(hostname)
```

Que fait le script :
1. `apt install jq curl gnupg acl alloy` (Grafana repo)
2. Extrait les 9 modules Alloy + render.sh embarqués
3. POST `/mgmt/agents/register` → reçoit `agent_id` + `agent_token`
4. Sauve les tokens dans `/var/lib/wgr-shipper/agent.json` (chmod 600)
5. Crée 2 services systemd :
   - `alloy.service` (paquet apt, déjà fourni)
   - `wgr-shipper-poll.service` (custom, fait le polling + reload)
6. Active et démarre les deux

## Install static mode

Sans API, avec un sources.json local :

```bash
# Prépare ton sources.json
sudo mkdir -p /etc/wgr-logs && sudo nano /etc/wgr-logs/sources.json
# Contenu : { "defaults": {...}, "sources": [...] }

curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
  | sudo bash -s -- \
      --ingest-token "$INGEST" \
      --sources-file /etc/wgr-logs/sources.json
```

## Architecture installée

```
/etc/alloy/
├── .env                          (chmod 600) : WGR_INGEST_URL, WGR_INGEST_USER, WGR_INGEST_TOKEN
├── config.alloy                  (généré par le render au boot, regénéré à chaque change de config)
└── modules/                      (9 fichiers .alloy, extraits par le script)

/etc/systemd/system/
├── alloy.service.d/wgr-env.conf  (drop-in : EnvironmentFile=/etc/alloy/.env)
└── wgr-shipper-poll.service      (managed mode only)

/usr/local/bin/
├── wgr-shipper-render            (render.sh, JSON → config.alloy)
└── wgr-shipper-poll              (managed mode only, boucle de polling)

/var/lib/wgr-shipper/
├── agent.json                    (chmod 600) : { agent_id, agent_token, status }  (managed mode only)
├── last-etag                     (dernier ETag connu)                              (managed mode only)
└── sources.json                  (cache de la dernière config reçue)               (managed mode only)
```

## Flow managed

```
toutes les 60s :
  wgr-shipper-poll → curl /mgmt/agents/<id>/config (Bearer agent_token)
                  ← ETag + rendered config
  
  si ETag changé :
    → wgr-shipper-render → /etc/alloy/config.alloy
    → systemctl reload alloy
```

## Voir les logs

```bash
# Alloy (l'agent qui pousse les logs)
sudo journalctl -u alloy -n 50 -f

# Le poller (la boucle managed)
sudo journalctl -u wgr-shipper-poll -n 50 -f

# Status
sudo systemctl status alloy wgr-shipper-poll
```

## Permissions (ACL)

Le service Alloy tourne sous l'user `alloy`. Pour qu'il puisse lire des logs d'apps (ex: PM2, CakePHP), il faut donner les ACL :

```bash
# Exemple PM2 (user pm2 = debian)
sudo setfacl -m u:alloy:rx /home/debian /home/debian/.pm2 /home/debian/.pm2/logs
sudo setfacl -m u:alloy:r  /home/debian/.pm2/logs/*.log 2>/dev/null
sudo setfacl -d -m u:alloy:r /home/debian/.pm2/logs

# Exemple CakePHP / WordPress sous /var/www
sudo setfacl -R -m u:alloy:rX /var/www
sudo setfacl -d -R -m u:alloy:rX /var/www
```

Si l'agent rapporte 0 logs sur un type particulier, c'est souvent une perm ACL manquante.

## Update (nouvelle version du script)

Re-lance le `curl | sudo bash` :
- Les modules + render.sh seront ré-écrits avec la nouvelle version
- Le `agent.json` est conservé (pas de re-enrôlement)
- `systemctl restart alloy wgr-shipper-poll` est fait par le script

## Désinstaller

```bash
sudo bash install-shipper.sh --uninstall
```

Effet :
- Stop + disable `wgr-shipper-poll` (l'unit reste mais est désactivée)
- Supprime `/etc/alloy/modules/`, `config.alloy`, `.env` drop-in, `/usr/local/bin/wgr-shipper-*`
- **Conserve** : le package `alloy` (apt), le state `/var/lib/wgr-shipper/`, le repo apt grafana

Cleanup complet :
```bash
sudo apt purge -y alloy
sudo rm -rf /etc/apt/sources.list.d/grafana.list /etc/apt/keyrings/grafana.gpg
sudo rm -rf /var/lib/wgr-shipper
```

L'agent reste dans la DB côté API. À supprimer via l'UI desktop si tu veux qu'il disparaisse.

## Cas typique : migrer un serveur PM2 du setup Alloy manuel

Si tu as installé Alloy à la main (cf. ancien `docs/alloy-pm2.md`), tu peux migrer :

```bash
# 1. Stopper l'ancien
sudo systemctl stop alloy

# 2. Backup l'ancien config
sudo cp /etc/alloy/config.alloy /root/old-alloy-config.alloy.bak

# 3. Lancer le nouveau installer (managed mode)
curl -sSL .../install-shipper.sh | sudo bash -s -- \
  --api-url https://<LOGS_DOMAIN>/mgmt \
  --register-token "$REGISTER" \
  --ingest-token "$INGEST" \
  --name $(hostname)

# 4. Dans l'UI desktop, l'agent apparaît. Ajouter les sources qu'avait l'ancien config.
```

## Debug

| Symptôme | Diagnostic |
|---|---|
| `Registration failed` | `--register-token` invalide, vérifier dans le `.env` wgr-logs |
| `Alloy not running` après install | `journalctl -u alloy -n 50` — souvent une erreur de syntaxe dans le config rendu, ou un mount manquant |
| Agent visible UI mais 0 logs | ACL manquante côté serveur (le user `alloy` ne lit pas les fichiers) |
| Reload pas pris en compte | `sudo systemctl reload alloy` manuellement, puis check `journalctl -u alloy --since "1 min"` |

## Voir aussi

- [`api.md`](api.md) — les endpoints utilisés par le poller
- [`shipper-docker.md`](shipper-docker.md) — alternative avec Docker (préférable si dispo)
- [`shipper-php.md`](shipper-php.md) — alternative pour mutualisé sans systemd
