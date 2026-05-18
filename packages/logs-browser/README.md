# @wgr/logs-browser

Tiny browser logger that ships errors and custom log lines to wgr-logs through a Cloudflare Worker collector. Zero deps, ~3 KB minified.

## Install

```bash
npm install @wgr/logs-browser
```

(Or, in this monorepo as a workspace dep: `"@wgr/logs-browser": "workspace:*"`)

## Usage

```ts
import { initLogger } from '@wgr/logs-browser'

const logger = initLogger({
  collector: 'https://collector.example.com',  // your wgr-browser-collector Worker URL
  app: 'my-site',                              // must match ALLOWED_APPS on the collector
  env: 'prod',                                 // prod | staging | dev
  release: process.env.GIT_SHA,                // optional, included in every line
  // autoHook: true (default) — captures window.onerror + unhandledrejection
})

// Manual logging
logger.error('payment failed', { order_id: 1234 })
logger.warn('slow response')
logger.info('viewed product', { sku: 'ABC-123' })
logger.debug('cache miss')

// User identity
logger.setUser('user-42')   // sets user_id on subsequent logs
logger.setUser(null)        // clears

// Manual flush (useful before logout / navigation)
await logger.flush()
```

## How it works

```
your-site (browser)
   │
   │ batches logs in memory, flushes:
   │   - every 2s
   │   - when batch >= 50 lines
   │   - on pagehide (via sendBeacon — survives navigation)
   │
   ▼ POST /push (no auth from browser — the Worker holds the token)
wgr-browser-collector (Cloudflare Worker)
   │  validates Origin + app + size, sanitises fields
   ▼ POST /loki/api/v1/push (with INGEST_AUTH_TOKEN)
Loki
```

Each log line carries:
- `level` — debug | info | warn | error
- `msg` — message string
- `stack` — for caught/uncaught errors
- `url` — current page (auto)
- `ua` — user agent (auto)
- `release` — from initLogger options
- `user_id` — from setUser
- `ctx` — arbitrary JSON context

## Options

| Option | Default | Notes |
|---|---|---|
| `collector` | — (required) | URL of your `wgr-browser-collector` Worker |
| `app` | — (required) | Label, must be in the collector's `ALLOWED_APPS` |
| `env` | `prod` | Label |
| `release` | — | App version, included in every line |
| `user` | — | Initial user id (or use `setUser()`) |
| `autoHook` | `true` | Captures `window.onerror` + `unhandledrejection` |
| `hookConsoleError` | `false` | Also forwards `console.error` calls (can be noisy) |
| `flushIntervalMs` | `2000` | How often to flush the buffer |
| `maxBatchSize` | `50` | Force flush when buffer reaches this |
| `dryRun` | `false` | Don't actually push (for tests / local dev) |

## Examples

### Nuxt 3 / 4 plugin

`plugins/logger.client.ts`:
```ts
import { initLogger } from '@wgr/logs-browser'

export default defineNuxtPlugin(() => {
  const logger = initLogger({
    collector: 'https://collector.example.com',
    app: 'my-nuxt-site',
    env: useRuntimeConfig().public.env,
    release: useRuntimeConfig().public.gitSha,
  })

  // Provide it everywhere
  return {
    provide: { logger },
  }
})
```

Then `const { $logger } = useNuxtApp(); $logger.info(...)`.

### Vue 3 (Vite)

`main.ts`:
```ts
import { initLogger } from '@wgr/logs-browser'

const logger = initLogger({
  collector: 'https://collector.example.com',
  app: 'my-vue-app',
  env: import.meta.env.MODE,
  release: import.meta.env.VITE_GIT_SHA,
})

app.config.errorHandler = (err, _vm, info) => {
  logger.error(`Vue error: ${err}`, { info, stack: (err as Error).stack })
}
```

### Plain HTML / vanilla JS

```html
<script type="module">
  import { initLogger } from 'https://unpkg.com/@wgr/logs-browser/dist/index.js'
  const logger = initLogger({
    collector: 'https://collector.example.com',
    app: 'static-site',
  })
  window.logger = logger
</script>
```

## What the lib NEVER does

- **Never throws** — fetch errors / sendBeacon failures are silently swallowed
- **Never blocks** — all flushes are async
- **Never includes the INGEST token** — that's the Worker's job
- **Never breaks the host page** — even with bad input, the worst case is `logger.error()` becoming a no-op

## Tests

```bash
npm test -w @wgr/logs-browser
```

## See also

- [`../../docs/browser-collector.md`](../../docs/browser-collector.md) — full deploy + setup guide
- [`../../apps/wgr-browser-collector/`](../../apps/wgr-browser-collector/) — the Worker source
