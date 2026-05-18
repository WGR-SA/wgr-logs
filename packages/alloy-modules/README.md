# @wgr/alloy-modules

Bibliothèque de fragments Grafana Alloy paramétrables, partagés par `wgr-logs-shipper` (image Docker) et `scripts/install-shipper.sh` (bash installer).

Chaque module définit un trio cohérent `local.file_match` / `loki.process` / `loki.source.file`, suffixé par `{{INDEX}}` pour permettre plusieurs instances du même type sans collision.

## Placeholders supportés

| Placeholder | Source | Exemple |
|---|---|---|
| `{{INDEX}}` | injecté par le renderer | `0`, `1`, `2` |
| `{{ENV}}` | `defaults.env` ou override par source | `prod`, `staging` |
| `{{HOST}}` | `defaults.host` ou hostname auto | `vps-pm2-01` |
| `{{CLUSTER}}` | `defaults.cluster` | `wgr-prod` |
| `{{BASE_DIR}}` | spécifique au module | `/var/www` |
| `{{PATH}}` | spécifique au module | `/var/log/myapp` |
| `{{APP}}` | spécifique au module (mono-app) | `cab-data` |
| `{{LABEL_NAME}}` / `{{LABEL_VALUE}}` | pour `files.alloy` (multi-paire) | — |

Les variables non remplacées dans un module ne sont **pas** une erreur — Alloy s'en chargera s'il en a besoin via env. Mais le renderer doit substituer tout placeholder référencé par le type.

## Modules disponibles

- `_header.alloy` — `logging{}` + `loki.write "wgr"` (inclus 1× en début de config)
- `pm2.alloy` — tail `<PM2_PATH>/*.log`, extrait `app` du nom de fichier
- `cakephp.alloy` — auto-discovery `<BASE_DIR>/<app>/logs/*.log` (CakePHP 3+) + `<BASE_DIR>/<app>/app/tmp/logs/*.log` (CakePHP 2.x)
- `wordpress.alloy` — auto-discovery `<BASE_DIR>/<site>/wp-content/debug.log`
- `prestashop.alloy` — auto-discovery `<BASE_DIR>/<site>/var/logs/*.log`
- `nginx.alloy` — `/var/log/nginx/{access,error}.log`
- `journald.alloy` — systemd journal
- `docker.alloy` — `/var/lib/docker/containers/*/*-json.log`
- `files.alloy` — glob générique + labels custom

## Convention de naming

Les blocs River sont nommés `<module>_<index>` :

```river
local.file_match "pm2_0" { ... }
loki.process    "pm2_0" { ... }
loki.source.file "pm2_0" { ... }
```

Le `_header.alloy` ne porte pas d'index.
