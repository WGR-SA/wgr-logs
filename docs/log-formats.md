# Log formats — config recipes per stack

Each tech has its own log format. The PHP cron pusher and the Alloy modules need to know:
1. **Where the logs live** (path glob)
2. **How to detect entry start** (multi-line grouping)
3. **How to detect the level** from the message

This doc is the canonical reference. Configs below are for the PHP cron pusher (`scripts/php-pusher/wgr-logs-push.php`). Equivalent Alloy patterns are noted where they differ.

## CakePHP (2 / 3 / 4 / 5)

### Path

| Version | Path |
|---|---|
| CakePHP 2.x | `<app>/app/tmp/logs/*.log` |
| CakePHP 3+ | `<app>/logs/*.log` |

Common filenames: `error.log`, `debug.log`, `queries.log`, `cli-error.log`, `info.log`, `notice.log`.

### Format (Cake default `FileLog` engine, no formatter)

A single entry spans multiple lines. New entries start with `YYYY-MM-DD HH:MM:SS LEVEL: ` :

```
2026-05-18 10:23:45 Error: [MissingControllerException] Controller class Robots.txtController could not be found.
Exception Attributes: array (
  'class' => 'Robots.txtController',
  'plugin' => NULL,
)
Request URL: /robots.txt
Stack Trace:
#0 /home/.../app/webroot/index.php(110): Dispatcher->dispatch(...)
#1 {main}
```

### Recommended source config

```json
{
  "type": "cakephp",
  "glob": "<BASE>/sites/*/logs/*.log",
  "app_from_path": "#/sites/([^/]+)/logs/#",
  "multiline_start": "#^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} #",
  "level_from_msg": {
    "\\bFatal( error)?\\b|FATAL": "error",
    "\\bError\\b|\\bException\\b|^Exception ": "error",
    "\\bWarning\\b|\\bWARN\\b": "warn",
    "\\bNotice\\b|\\bDeprecated\\b": "info",
    "\\bDebug\\b": "debug"
  },
  "labels": { "framework": "cakephp" }
}
```

For CakePHP 2 (different path):
```json
{
  "type": "cakephp2",
  "glob": "<BASE>/sites/*/app/tmp/logs/*.log",
  "app_from_path": "#/sites/([^/]+)/app/tmp/logs/#",
  "multiline_start": "#^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} #",
  "level_from_msg": { /* same as above */ },
  "labels": { "framework": "cakephp2" }
}
```

### If the app uses `Cake\Log\Formatter\JsonFormatter` (recommended)

One line of JSON per entry → no `multiline_start` needed, Loki auto-extracts `level` from the JSON via its built-in `detected_level`:

```json
{
  "type": "cakephp",
  "glob": "<BASE>/sites/*/logs/*.log",
  "app_from_path": "#/sites/([^/]+)/logs/#",
  "labels": { "framework": "cakephp" }
}
```

## WordPress

### Path

`<site>/wp-content/debug.log` — only exists when `define('WP_DEBUG_LOG', true);` is set in `wp-config.php`.

### Format

```
[18-May-2026 11:23:45 UTC] PHP Warning: Undefined variable $x in /path/to/file.php on line 42
```

PHP fatals can also be multi-line (stack trace continues with `#0 /...`, `#1 ...`).

### Recommended source config

```json
{
  "type": "wordpress",
  "glob": "<BASE>/sites/*/wp-content/debug.log",
  "app_from_path": "#/sites/([^/]+)/wp-content/#",
  "multiline_start": "#^\\[\\d{1,2}-[A-Za-z]{3}-\\d{4} \\d{2}:\\d{2}:\\d{2} [A-Z]+\\]#",
  "level_from_msg": {
    "PHP Fatal error|PHP Parse error": "error",
    "PHP Warning": "warn",
    "PHP (Notice|Deprecated)": "info"
  },
  "labels": { "framework": "wordpress" }
}
```

## PrestaShop / Symfony / Monolog

### Path

- PrestaShop 1.7+ / Symfony: `<app>/var/logs/*.log`
- PrestaShop 1.6 legacy: `<app>/log/*.log`

### Format (default Monolog `LineFormatter`)

```
[2026-05-18 10:23:45] app.ERROR: Something broke {"exception":"[object] (Exception ...)"} {"file":"..."}
```

Single line per entry. Format is `[<timestamp>] <channel>.<LEVEL>: <message> <context> <extra>`.

### Recommended source config

```json
{
  "type": "prestashop",
  "glob": "<BASE>/sites/*/var/logs/*.log",
  "app_from_path": "#/sites/([^/]+)/var/logs/#",
  "level_from_msg": {
    "\\.(EMERGENCY|ALERT|CRITICAL|ERROR):": "error",
    "\\.WARNING:": "warn",
    "\\.(NOTICE|INFO):": "info",
    "\\.DEBUG:": "debug"
  },
  "labels": { "framework": "prestashop" }
}
```

If Monolog is configured with `JsonFormatter`, drop `level_from_msg` (Loki auto-extracts).

## PM2

### Path

`~/.pm2/logs/*-out.log` (stdout) and `*-error.log` (stderr).

### Format

Whatever the app prints. If the app logs JSON → Loki auto-extracts level.

### Recommended source config

For text apps (most cases), set the level from the filename suffix:

```json
{
  "type": "pm2",
  "glob": "/home/<user>/.pm2/logs/*.log",
  "app_from_path": "#/([^/]+)-(out|error)\\.log$#",
  "labels": { "framework": "pm2" }
}
```

Note: `app_from_path` captures `<app_name>` from `<app_name>-(out|error).log`. The `stream` (out/error) isn't captured here but could be added via a more complex regex.

For Alloy (Docker/bash shipper), the `pm2.alloy` module does this correctly via `stage.regex` + `stage.labels`.

## nginx

### Path

`/var/log/nginx/access.log` and `/var/log/nginx/error.log`.

### Format

- Access (default combined): `<ip> - <user> [<date>] "<method> <path> <proto>" <status> <bytes> "<referer>" "<ua>"`
- Error: `<date> [<level>] <pid>#<tid>: <message>`

Both single-line per entry.

### Recommended source config

```json
[
  {
    "type": "nginx",
    "glob": "/var/log/nginx/access.log",
    "app": "nginx",
    "labels": { "framework": "nginx", "stream": "access" }
  },
  {
    "type": "nginx",
    "glob": "/var/log/nginx/error.log",
    "app": "nginx",
    "level_from_msg": {
      "\\[crit\\]|\\[alert\\]|\\[emerg\\]|\\[error\\]": "error",
      "\\[warn\\]": "warn",
      "\\[notice\\]|\\[info\\]": "info"
    },
    "labels": { "framework": "nginx", "stream": "error" }
  }
]
```

For Alloy, `nginx.alloy` handles this differently — see `packages/alloy-modules/nginx.alloy`.

## Infomaniak `ik-logs/` (shared hosting host-level)

### Path

`~/ik-logs/*.log` — Infomaniak's host-level logs, auto-populated daily.

Files seen: `php-fpm.log`, `error.log`, `access.log`.

### Format

- `php-fpm.log`: `[18-May-2026 10:23:45 UTC] WARNING: ...` (PHP-FPM)
- `error.log`: nginx error format
- `access.log`: nginx access format

### Recommended source config

```json
{
  "type": "ik-host",
  "glob": "<BASE>/ik-logs/*.log",
  "app": "mutu-host",
  "labels": { "framework": "infomaniak" }
}
```

Level extraction varies per file; we keep `level=info` by default and rely on Loki's auto-detect for the rest.

## Symfony 4+ (standalone)

Same as PrestaShop / Symfony pattern. JSON Monolog formatter recommended for better querying.

## Laravel

### Path

`<app>/storage/logs/*.log` (default `single` channel) or `<app>/storage/logs/laravel-YYYY-MM-DD.log` (default `daily` channel).

### Format

```
[2026-05-18 10:23:45] production.ERROR: SomeException ... {"exception":"..."}
```

Multi-line for stack traces.

### Recommended source config

```json
{
  "type": "laravel",
  "glob": "<BASE>/sites/*/storage/logs/*.log",
  "app_from_path": "#/sites/([^/]+)/storage/logs/#",
  "multiline_start": "#^\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\]#",
  "level_from_msg": {
    "\\.(EMERGENCY|ALERT|CRITICAL|ERROR):": "error",
    "\\.WARNING:": "warn",
    "\\.(NOTICE|INFO):": "info",
    "\\.DEBUG:": "debug"
  },
  "labels": { "framework": "laravel" }
}
```

## Generic JSON-line logs

If your app already logs one JSON object per line (recommended for all new apps), just use:

```json
{
  "type": "json-app",
  "glob": "/var/log/myapp/*.log",
  "labels": { "framework": "json", "app": "myapp" }
}
```

No `multiline_start` (one line = one JSON entry), no `level_from_msg` (Loki's `detected_level` auto-extracts the `level` field from the JSON).

## How `level_from_msg` works

The pusher applies your regexes **in order** against each entry's message. The first match wins. The matched level becomes the `level` label on the resulting Loki stream.

If no regex matches → `level=info` (default fallback).

Tips:
- Order matters — most specific first
- Patterns are case-insensitive by default (the pusher adds `i` flag if you don't supply your own delimiters)
- Use `\\b` word boundaries to avoid false positives (`Error in /path/foo`)

## How `multiline_start` works

The pusher accumulates lines into one entry until it sees a line matching the regex. That line starts the **next** entry.

Without `multiline_start`: 1 line = 1 entry (default).

Edge cases:
- File begins mid-entry (continuation lines before any "start" match) → those continuation lines are emitted as standalone entries
- At EOF, the last in-progress entry is flushed

## Complete mutu config example

See `examples/config.shared-hosting.json` (planned) or copy from `scripts/php-pusher/config.example.json`.
