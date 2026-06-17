Diagnostiquer pourquoi une cible ne remonte pas (ou mal) dans Loki. **Lecture seule — ne rien modifier.**

Étapes :
1. `http_admin_api GET /mgmt/agents/:id` + `GET /mgmt/agents/:id/sources` (état de l'agent, sources, statut, dernière `config_version`).
2. `http_loki_query` `count_over_time({host="<name>"}[15m])` (et par source si utile).
3. `php-mutu` : `ssh_exec` (lecture) `ls -la ~/wgr-logs/.state` + cat du `last-run.json` distant. Autres kinds : logs du service / dernier run.
4. Croise les signaux (offsets, erreurs gRPC > limite, 429, agent `disabled`, source absente, app silencieuse).

Critère de succès : un résumé des **root-cause candidates** classées par probabilité, avec la preuve (extrait de log / valeur d'état) pour chacune, et la commande de repair suggérée (`repair --issue ...`) — **sans l'appliquer**.
