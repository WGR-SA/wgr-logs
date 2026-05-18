# Low-level connectors

> 📖 **For most cases, use the wgr-logs shippers (managed via the desktop UI).**
> See: [`shipper-docker.md`](shipper-docker.md) | [`shipper-bash.md`](shipper-bash.md) | [`shipper-php.md`](shipper-php.md)
>
> This document describes **low-level patterns** (Docker Loki driver, direct HTTP push, etc.) — useful for special cases where the shippers don't fit (Cloudflare Workers, Tauri user-side apps, browser).

All connectors push to `https://<INGEST_DOMAIN>/loki/api/v1/push` with a shared token (`INGEST_AUTH_TOKEN`). This token is separate from the Grafana admin password.

## Label rules

**Low cardinality only.** Good labels: `app`, `env`, `host`, `level`, `service`, `cluster`. **Never**: `user_id`, `request_id`, `trace_id`, full `path`, `ip` — they explode the Loki index. Put them in the JSON line, they remain grep-able via LogQL.

---

## 1. Docker apps (native Loki driver) — simplest

### Prerequisites (once per Docker host)

```bash
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
```

### In any `docker-compose.yml`

```yaml
services:
  myapp:
    image: myimage:latest
    logging:
      driver: loki
      options:
        loki-url: "https://<INGEST_DOMAIN>/loki/api/v1/push"
        loki-batch-size: "400"
        loki-retries: "3"
        loki-external-labels: "app=myapp,env=prod,host={{.Name}}"
        loki-pipeline-stages: |
          - json:
              expressions:
                level: level
                msg: msg
          - labels:
              level:
```

App-side (Nuxt, Strapi, NestJS), log **JSON to stdout** (pino, winston, or `console.log(JSON.stringify({...}))`). The pipeline above extracts `level` automatically.

### Bearer auth

The Loki driver doesn't support Bearer natively, but accepts BasicAuth. With Traefik on the server side, you can convert BasicAuth → header:

```yaml
loki-url: "https://wgr:${INGEST_AUTH_TOKEN}@<INGEST_DOMAIN>/loki/api/v1/push"
```

---

## 2. Linux server (Alloy)

On the VPS itself, Alloy runs in the stack and reads `/var/log/*` + `/run/log/journal` mounted as read-only volumes. No additional setup needed.

### For another server (a second VPS, etc.)

Use [`shipper-bash.md`](shipper-bash.md). Avoid setting up Alloy manually — the bash installer does it for you with a working config + managed mode.

---

## 3. Cloudflare Workers (Tail Worker)

No agent possible inside a Worker — use a dedicated **Tail Consumer Worker**.

### Worker `cf-worker-logs-tail` (skeleton)

`wrangler.toml`:
```toml
name = "cf-worker-logs-tail"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[[tail_consumers]]
service = "mysite-prod"   # the Worker whose logs we collect

[vars]
LOKI_URL = "https://<INGEST_DOMAIN>/loki/api/v1/push"
APP = "mysite"
ENV = "prod"
# INGEST_AUTH_TOKEN added via `wrangler secret put`
```

`src/index.ts`:
```ts
export interface Env {
  LOKI_URL: string
  APP: string
  ENV: string
  INGEST_AUTH_TOKEN: string
}

export default {
  async tail(events: TraceItem[], env: Env): Promise<void> {
    const stream = { app: env.APP, env: env.ENV, source: 'cf-worker' }
    const values: [string, string][] = events.flatMap((e) => {
      const ts = `${(e.eventTimestamp ?? Date.now()) * 1_000_000}`
      return e.logs.map((log) => [
        ts,
        JSON.stringify({
          level: log.level,
          msg: log.message?.join(' '),
          script: e.scriptName,
          outcome: e.outcome,
          duration: e.cpuTime
        })
      ])
    })
    if (values.length === 0) return

    const auth = btoa(`wgr:${env.INGEST_AUTH_TOKEN}`)
    await fetch(env.LOKI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify({ streams: [{ stream, values }] })
    })
  }
}
```

Deploy:
```bash
wrangler secret put INGEST_AUTH_TOKEN
wrangler deploy
```

One tail consumer = one source. Or make a generic tail consumer with multiple `tail_consumers` entries.

> ✅ For a turn-key solution, see [`cf-workers.md`](cf-workers.md) and the `wgr-tail-collector` Worker in `apps/wgr-tail-collector/`. The snippet above is the underlying pattern.

---

## 4. Tauri app (user-side)

To capture client-side errors (opt-in):

```ts
// app/utils/remoteLog.ts
import { fetch } from '@tauri-apps/plugin-http'

export async function pushLog(level: string, msg: string, ctx: object = {}) {
  const ts = `${Date.now() * 1_000_000}`
  await fetch('https://<INGEST_DOMAIN>/loki/api/v1/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`wgr:${INGEST_TOKEN}`)}`
    },
    body: JSON.stringify({
      streams: [{
        stream: { app: 'myapp', env: 'prod', level, source: 'desktop' },
        values: [[ts, JSON.stringify({ msg, ...ctx })]]
      }]
    })
  })
}
```

The token is provided via a signed temporary URL (server-side) or via the update server — **never hardcoded in the bundle**.

---

## 5. Browser endpoint (static sites, JS errors)

Dedicated small Worker proxy that accepts CORS and forwards to Loki with validation (rate limit + sampling). Same pattern as #3 but triggered by client-side `fetch()` on `error.window`.

> ✅ For a turn-key solution, see [`browser-collector.md`](browser-collector.md), the `wgr-browser-collector` Worker, and the `@wgr/logs-browser` JS lib. The snippet from #3 is the underlying pattern.

---

## Quick verification

After connecting a source, check in Grafana → Explore:

```logql
{app="your-app"} | last 5m
```

If nothing shows up:
1. `docker plugin ls` (Loki driver active)
2. `curl -I https://<INGEST_DOMAIN>/ready` (HTTP 200)
3. `docker logs <your-service>` (Loki driver errors are on stderr)
