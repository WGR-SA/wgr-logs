# @wgr/alloy-modules

Library of parameterised Grafana Alloy fragments, shared by `wgr-logs-shipper` (Docker image) and `scripts/install-shipper.sh` (bash installer).

Each module defines a coherent trio `local.file_match` / `loki.process` / `loki.source.file`, suffixed with `{{INDEX}}` to allow multiple instances of the same type without collision.

## Supported placeholders

| Placeholder | Source | Example |
|---|---|---|
| `{{INDEX}}` | injected by the renderer | `0`, `1`, `2` |
| `{{ENV}}` | `defaults.env` or per-source override | `prod`, `staging` |
| `{{HOST}}` | `defaults.host` or auto-detected hostname | `vps-pm2-01` |
| `{{CLUSTER}}` | `defaults.cluster` | `prod` |
| `{{BASE_DIR}}` | module-specific | `/var/www` |
| `{{PATH}}` | module-specific | `/var/log/myapp` |
| `{{TARGETS}}` | `files.alloy` only (paths + labels expanded) | — |

Unsubstituted variables in a module are **not** an error — Alloy will handle them via env if needed. But the renderer must substitute every placeholder referenced by the type.

## Available modules

- `_header.alloy` — `logging{}` + `loki.write "wgr"` (included once at the top of the config)
- `pm2.alloy` — tails `<PM2_PATH>/*.log`, extracts `app` from the filename
- `cakephp.alloy` — auto-discovers `<BASE_DIR>/<app>/logs/*.log` (CakePHP 3+) + `<BASE_DIR>/<app>/app/tmp/logs/*.log` (CakePHP 2.x)
- `wordpress.alloy` — auto-discovers `<BASE_DIR>/<site>/wp-content/debug.log`
- `prestashop.alloy` — auto-discovers `<BASE_DIR>/<site>/var/logs/*.log` and `<BASE_DIR>/<site>/log/*.log`
- `nginx.alloy` — `/var/log/nginx/{access,error}.log`
- `journald.alloy` — systemd journal
- `docker.alloy` — `/var/lib/docker/containers/*/*-json.log` via docker socket
- `files.alloy` — generic glob + custom labels

## Naming convention

River blocks are named `<module>_<index>`:

```river
local.file_match "pm2_0" { ... }
loki.process    "pm2_0" { ... }
loki.source.file "pm2_0" { ... }
```

`_header.alloy` doesn't carry an index.

## JSON schema

`schemas/source-types.json` contains the JSON schema for each source type. Used by:
- The API (`/mgmt/source-types`) to validate `config` payloads when creating sources
- The desktop UI to generate the source form dynamically
