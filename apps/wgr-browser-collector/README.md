# wgr-browser-collector

Public Cloudflare Worker that accepts log batches from browsers (via `@wgr/logs-browser`) and forwards them to the wgr-logs Loki endpoint server-side.

Full guide: [`../../docs/browser-collector.md`](../../docs/browser-collector.md)

## Why a Worker?

The browser must not hold the `INGEST_AUTH_TOKEN` (it would be public in the bundle, instant abuse). This Worker holds the token as a secret and adds it server-side, while validating Origin + app + sizing.

```
browser  ──fetch POST /push──►  wgr-browser-collector  ──Loki push──►  <INGEST_DOMAIN>
                                (token added here)
```

## Protections

1. **CORS**: Origin must be in `ALLOWED_ORIGINS`
2. **App allowlist**: payload.app must be in `ALLOWED_APPS`
3. **Size cap**: `MAX_PAYLOAD_BYTES` (default 64 KB)
4. **Batch cap**: `MAX_LOGS_PER_BATCH` (default 100)
5. **Server-side timestamp**: client clock is hint only
6. **Field caps**: msg ≤ 4 KB, stack ≤ 8 KB, url ≤ 1 KB, ua ≤ 512 B, ctx ≤ 4 KB JSON

## Deploy

```bash
cd apps/wgr-browser-collector
npm install
wrangler login

# Edit wrangler.toml: set ALLOWED_ORIGINS + ALLOWED_APPS + INGEST URL
nano wrangler.toml

# Set the secret token
wrangler secret put WGR_INGEST_TOKEN
# (paste the same INGEST_AUTH_TOKEN used by the stack)

wrangler deploy
```

After deploy, the Worker is reachable at `https://wgr-browser-collector.<your-account>.workers.dev/push`. Bind a custom domain in `wrangler.toml` if you want a stable URL.

## Endpoint

`POST /push`

```json
{
  "app": "yoursite",
  "env": "prod",
  "logs": [
    {
      "level": "error",
      "msg": "Uncaught TypeError: ...",
      "stack": "...",
      "url": "https://yoursite.com/page",
      "ua": "Mozilla/5.0...",
      "release": "v1.2.3",
      "user_id": "anon-xxx",
      "ctx": { "extra": "context" }
    }
  ]
}
```

Returns **202** on accept (push is async via `ctx.waitUntil`), **400/403/413** on rejection.

## Labels emitted to Loki

- `app=<from payload.app>` (validated against `ALLOWED_APPS`)
- `env=<from payload.env, default 'prod'>`
- `level=<debug|info|warn|error>`
- `source=browser`

Other fields (msg, stack, url, ua, release, user_id, ctx) go into the log line as JSON.

## Tail the collector

```bash
wrangler tail wgr-browser-collector
```

Logs `[wgr-browser-collector] push failed: …` indicate problems forwarding to Loki.

## Local dev

```bash
wrangler dev
# In another terminal:
curl -X POST http://127.0.0.1:8787/push \
  -H "Content-Type: application/json" \
  -H "Origin: https://yoursite.com" \
  -d '{"app":"yoursite","logs":[{"level":"error","msg":"test"}]}'
```

## Files

```
apps/wgr-browser-collector/
├── src/index.ts          # the Worker handler
├── wrangler.toml         # config + ALLOWED_ORIGINS + ALLOWED_APPS
├── package.json
├── tsconfig.json
└── README.md             # this file
```
