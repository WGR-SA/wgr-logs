Enrôler le shipper sur la cible, **proposer une config de sources adaptée à CE serveur** (tu es la fonction de config — n'assume aucune structure type), la faire valider, puis vérifier la remontée dans Loki.

Étapes :
1. **Check SSH** : confirme l'accès (`ssh_exec` lecture : `hostname`, `uname -a`).
2. **Idempotence** : `http_admin_api GET /mgmt/agents` → si un agent matche le nom/hostname, réutilise-le (ne re-register pas).
3. **Mode selon `kind`** :
   - `bash` : uploade + exécute `scripts/install-shipper.sh` (`--api-url --register-token --ingest-token --name`). Token registration injecté par l'outil.
   - `docker` : uploade `docker-compose.managed.yml` + `.env`, puis `docker compose up -d`.
   - `php-mutu` : uploade `wgr-logs-push.php`, `cron-trigger.php`, `config.example.json` (adapté), génère le `.cron-token` (`secret_create`), pose le cron URL.
4. **Register** (si pas idempotent) : `POST /mgmt/agents/register` (`name`, `hostname`, `shipper_kind` — mappe `php-mutu`→`php`, `shipper_ver`, `env`). Persiste l'`agent_id`.
5. **Inventaire** : `detect_sources` → `{ services, logDirs }`. `services` = sources prêtes (journald, nginx, apache, docker/compose, pm2). `logDirs` = répertoires bruts contenant des `*.log` (aucun glob pré-fait).
6. **Tu es la fonction de config** — propose une liste de sources adaptée à CE serveur :
   - Reprends les `services` tels quels.
   - Pour les `logDirs` : **raisonne sur leur structure réelle** (creuse au besoin avec `ssh_exec` lecture, ex. `ls`, `find`) et propose des sources `files` avec des globs pertinents — **doublestar `**` quand la profondeur varie**, **scopés par app/client/projet** quand c'est multi-tenant (ne propose JAMAIS un glob qui ramasse tous les tenants d'un coup sans le dire).
   - Pour chaque proposition : type, config (`paths`/`base_dir`/…), et **pourquoi**. Signale les risques (logs multi-tenant, secrets potentiels dans les logs applicatifs).
7. **Validation humaine** : présente la liste numérotée, puis crée **chaque source approuvée** via `POST /mgmt/agents/:agentId/sources`. Chaque création est *gated* → l'opérateur valide/refuse **source par source**. N'ajoute rien hors de la liste validée.
8. **Vérif** : après le 1er cycle de push (~60-90 s), `http_loki_query count_over_time({host="<name>"}[5m]) > 0`.

Critère de succès : l'hôte remonte dans Loki, l'agent est `active`/`pending`, et les sources validées sont créées.
