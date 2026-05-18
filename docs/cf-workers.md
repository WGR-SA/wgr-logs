# Cloudflare Workers — log collection

How to ship logs from Cloudflare Workers (which can't run a sidecar agent) into wgr-logs.

## Approach: Tail Consumer Worker

```
your-prod-worker  ──tail events──►  wgr-tail-collector  ──Loki push──►  <INGEST_DOMAIN>
                                    (Cloudflare Worker)
```

You deploy a small Cloudflare Worker `wgr-tail-collector` once. Each source Worker (your `cf-worker-*` services) registers it as a `tail_consumers` entry. From then on, every Worker invocation emits a trace event that goes to the collector, which forwards it to Loki.

Source code: `apps/wgr-tail-collector/`.

## Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI installed (`npm install -g wrangler`)
- `wrangler login` done
- The `INGEST_AUTH_TOKEN` from your wgr-logs stack

## 1. Deploy the collector (one-time)

```bash
cd apps/wgr-tail-collector
npm install

# Edit wrangler.toml: replace <INGEST_DOMAIN> with your real domain
nano wrangler.toml

# Set the secret token
wrangler secret put WGR_INGEST_TOKEN
# Paste your INGEST_AUTH_TOKEN

# Deploy
wrangler deploy
```

Output should show `wgr-tail-collector` deployed and reachable as a tail consumer.

## 2. Register a source Worker

For **each** Worker whose logs you want to collect:

**Option A — CLI (one-shot)**
```bash
wrangler tail-consumer add <source-worker-name> wgr-tail-collector
```

Or use the helper:
```bash
bash scripts/cf-tail/add-target.sh <source-worker-name>
```

**Option B — declarative (git-tracked)**

In the source Worker's `wrangler.toml`:
```toml
[[tail_consumers]]
service = "wgr-tail-collector"
```

Then `wrangler deploy` the source Worker.

## 3. Verify

Trigger your source Worker (curl its public URL, wait for a scheduled run, etc.), then in Grafana → Explore:

```logql
{source="cf-worker"}                              # all Worker logs
{source="cf-worker", app="my-prod-worker"}        # one specific Worker
{source="cf-worker", outcome="exception"}         # only failing invocations
{source="cf-worker", level="error"}               # errors only
```

You should see one log line per `console.log` / `console.error` / unhandled exception in your source Workers, with extra fields in the JSON payload: `script`, `outcome`, `duration_cpu`, `duration_wall`.

## What the collector emits

Per trace event from a source Worker, it emits:
- One Loki line per `log` entry (console.log / .info / .warn / .error)
- One Loki line per exception (unhandled errors)
- If outcome ≠ `ok` AND no logs/exceptions → a synthetic `level=error` line so the failure is visible

Each line is JSON:
```json
{
  "level": "info",
  "msg": "Processing job 1234",
  "script": "my-prod-worker",
  "duration_cpu": 12,
  "duration_wall": 45
}
```

Labels on the Loki stream:
- `app=<scriptName>`
- `env=<WGR_ENV>` (default `prod`, configurable via wrangler.toml)
- `cluster=<WGR_CLUSTER>`
- `source=cf-worker`
- `outcome=<ok|exception|exceededCpu|exceededMemory|scriptNotFound|canceled|unknown>`
- `level=<debug|info|warn|error>`

## Multi-env / multi-cluster

If you have prod + staging Workers and want them separated:

```bash
# Deploy a separate collector per env
wrangler deploy --env staging  # uses [env.staging] vars in wrangler.toml
```

Or have one collector but override `WGR_ENV` per source via wrangler vars (more complex).

## Debug

### Tail the collector itself

```bash
wrangler tail wgr-tail-collector
```

If you see `[wgr-tail-collector] push failed: 401` → wrong token. Re-run `wrangler secret put WGR_INGEST_TOKEN`.

If you see `[wgr-tail-collector] push error: <network error>` → check the `<INGEST_DOMAIN>` value in `wrangler.toml`.

### No logs in Grafana

1. Confirm the source Worker is actually emitting trace events (check `wrangler tail <source-worker>` directly)
2. Confirm the tail consumer is registered: `wrangler tail-consumer list <source-worker>`
3. Trigger the source Worker (request it via curl) — events flow on invocation, not idle

## Limitations

- **Latency**: 5–30 s typical (Cloudflare batches tail events server-side)
- **Quota**: 100M tail events per month on the Paid plan; consult Cloudflare pricing
- **No request body / response body capture** — only `outcome`, `cpuTime`, `wallTime`, `logs`, `exceptions`. For request paths or status codes, your source Worker must `console.log` them explicitly.
- **No registration with the admin UI** in v1 — the collector is configured at deploy time. Phase D.1 could add UI-driven config via KV.

## See also

- [`../apps/wgr-tail-collector/README.md`](../apps/wgr-tail-collector/README.md) — module README
- [`shipper-docker.md`](shipper-docker.md), [`shipper-bash.md`](shipper-bash.md), [`shipper-php.md`](shipper-php.md) — other shipper types
- [Cloudflare Tail Workers docs](https://developers.cloudflare.com/workers/observability/tail-workers/)
