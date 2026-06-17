Mettre à jour les scripts du shipper sur la cible, sans régression.

Étapes :
1. **Diff** : pour chaque artefact concerné par le `kind`, compare le sha256 local (worktree, via `local_fs_read`) à la copie distante (`ssh_get`).
2. **Upload** : `ssh_put` uniquement les fichiers qui diffèrent (gated).
3. **Validation** :
   - `php-mutu` : `php -l` sur le fichier uploadé.
   - `bash`/`docker` : reload du service (`systemctl reload wgr-logs-shipper` ou `docker compose up -d --force-recreate`).
4. **Re-trigger** un cycle de push.
5. **Rapport** : liste des fichiers changés (avec sha avant/après) + le nouveau `last-run.json`.

Critère de succès : les copies distantes matchent le worktree local et un nouveau cycle de push a réussi.
