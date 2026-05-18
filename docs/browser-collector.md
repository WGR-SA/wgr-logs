# Browser collector — ship JS errors from frontend apps

How to capture client-side errors and custom logs from your frontend apps (Nuxt, Vue, React, vanilla HTML, WordPress themes, anything that runs in a browser) into wgr-logs.

## Approach: public Worker + tiny JS lib

```
browser  ──fetch POST /push──►  wgr-browser-collector  ──Loki push──►  <INGEST_DOMAIN>
(@wgr/logs-browser)             (Cloudflare Worker)
```

Two pieces:
1. **`apps/wgr-browser-collector/`** — a public Cloudflare Worker holding the `INGEST_AUTH_TOKEN` server-side, validating Origin + app + sizes
2. **`packages/logs-browser/`** (`@wgr/logs-browser`) — tiny JS lib that the frontend embeds; auto-hooks `window.onerror` + `unhandledrejection` + exposes a manual API

## Why not push directly from the browser to Loki?

The browser would need to know the `INGEST_AUTH_TOKEN` → it would be in the JS bundle → instantly public → trivial abuse. The Worker proxy holds the token server-side and validates that requests come from your real sites.

## 1. Deploy the collector Worker (one-time)

```bash
cd apps/wgr-browser-collector
npm install
wrangler login

# Edit wrangler.toml: set ALLOWED_ORIGINS + ALLOWED_APPS + INGEST URL
nano wrangler.toml
```

Important variables in `wrangler.toml`:
- `ALLOWED_ORIGINS`: comma-separated list of the exact Origin headers your sites send. E.g. `https://yoursite.com,https://www.yoursite.com,https://app.yoursite.com`
- `ALLOWED_APPS`: comma-separated list of the `app` label values the Worker will accept. E.g. `yoursite,app-yoursite,docs`

Then:
```bash
wrangler secret put WGR_INGEST_TOKEN
# (paste your INGEST_AUTH_TOKEN)

wrangler deploy
```

Output: `https://wgr-browser-collector.<your-account>.workers.dev`.

Bind a stable custom domain via `wrangler.toml` `[[routes]]` if you want, e.g. `collector.example.com`.

## 2. Embed the lib in your frontend

```bash
npm install @wgr/logs-browser
```

In your app entry:
```ts
import { initLogger } from '@wgr/logs-browser'

const logger = initLogger({
  collector: 'https://collector.example.com',   // your Worker URL
  app: 'yoursite',                              // must be in ALLOWED_APPS
  env: 'prod',
  release: process.env.GIT_SHA,                 // for traceability
})

// That's it — uncaught errors are now captured.
// For manual logs:
logger.info('viewed product', { sku: 'ABC' })
logger.error('payment failed', { order_id: 1234 })
logger.setUser('user-42')
```

Full options + framework examples: see [`packages/logs-browser/README.md`](../packages/logs-browser/README.md).

## 3. Verify

Trigger an error on your frontend (open devtools and throw something: `throw new Error('test')`).

In Grafana → Explore:
```logql
{source="browser"}                              # all browser-side logs
{source="browser", app="yoursite"}              # one site
{source="browser", level="error"}               # errors only
{source="browser"} | json | line_format "{{.url}} {{.msg}}"
```

You should see your test error within ~2s (the lib batches every 2s).

## Protections enforced by the Worker

| Check | Purpose |
|---|---|
| **CORS Origin** | Only `ALLOWED_ORIGINS` can POST. Browsers enforce this; manual curl can spoof but limited reach. |
| **App allowlist** | Even if a malicious site spoofs Origin via curl, the `app` field must be in `ALLOWED_APPS`. |
| **Size cap** | Payload `MAX_PAYLOAD_BYTES` (default 64 KB) — refuses larger. |
| **Batch cap** | Max `MAX_LOGS_PER_BATCH` lines/request (default 100). |
| **Server-side timestamp** | Client clock is a hint only. |
| **Field caps** | msg 4 KB, stack 8 KB, url 1 KB, ua 512 B, ctx 4 KB JSON. |

## Labels emitted to Loki

- `app=<from payload>` (validated)
- `env=<from payload, default 'prod'>`
- `level=<debug|info|warn|error>`
- `source=browser`

Other data goes into the log line as JSON: `msg, stack, url, ua, release, user_id, ctx`.

Filter examples:
```logql
{source="browser", app="yoursite", level="error"}
{source="browser"} | json | release="v1.2.3"
{source="browser"} | json | user_id="user-42"
{source="browser"} | json | url=~".*/checkout.*"
```

## Sampling / rate limiting

For high-traffic sites, sample on the **client** side. The lib doesn't currently sample (TODO for v1.1). Quick workaround:

```ts
if (Math.random() < 0.1) {
  logger.error(...)  // 10% of errors only
}
```

The collector relies on Cloudflare's default DDoS protection. If you observe abuse, add explicit rate limiting via:
1. Cloudflare Rate Limiting (dashboard)
2. KV-backed per-IP counter in the Worker (small change in `src/index.ts`)

## v2 / not yet shipped

- **Source maps**: dedicated endpoint that resolves minified stack traces server-side. Mid-complexity, would need `sourcemap` files uploaded somewhere queryable.
- **Core Web Vitals**: capture LCP / CLS / INP via `web-vitals` and ship them through the same lib. Trivial addition.
- **Sampling controls**: server-side sampling rules (drop X% of debug logs, keep all errors, etc.) via collector env vars.

## Local dev

### Run the Worker locally

```bash
cd apps/wgr-browser-collector
wrangler dev
# Worker is at http://127.0.0.1:8787
```

Test with curl:
```bash
curl -X POST http://127.0.0.1:8787/push \
  -H "Content-Type: application/json" \
  -H "Origin: https://yoursite.com" \
  -d '{"app":"yoursite","logs":[{"level":"error","msg":"test"}]}'
```

### Test the lib in a real browser

Add `dryRun: true` in `initLogger()` to disable network pushes during local dev (logs to console only).

Or point at the local Worker URL: `collector: 'http://localhost:8787'`.

## Debug

| Symptom | Likely cause |
|---|---|
| Browser console shows CORS error | Your Origin isn't in `ALLOWED_ORIGINS`. Add it + redeploy the Worker. |
| 403 "app not allowed" | The `app` field doesn't match `ALLOWED_APPS`. |
| 413 "payload too large" | Reduce batch size, or increase `MAX_PAYLOAD_BYTES` in wrangler.toml. |
| Worker tail shows push failed: 401 | Wrong `WGR_INGEST_TOKEN` secret. Re-run `wrangler secret put WGR_INGEST_TOKEN`. |
| No logs in Grafana, no errors anywhere | The lib silently swallows network errors (by design). Use `wrangler tail wgr-browser-collector` to see what the Worker receives. |

## See also

- [`packages/logs-browser/README.md`](../packages/logs-browser/README.md) — lib API + framework examples
- [`apps/wgr-browser-collector/`](../apps/wgr-browser-collector/) — Worker source
- [`cf-workers.md`](cf-workers.md) — for CF Worker logs (Phase D)
