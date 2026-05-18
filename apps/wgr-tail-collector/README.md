# wgr-tail-collector

Cloudflare Tail Worker. Receives `TraceItem[]` events from other Workers (configured as `tail_consumers`) and forwards them to wgr-logs as Loki log lines.

Full guide: [`../../docs/cf-workers.md`](../../docs/cf-workers.md)

## How it works

```
your-prod-worker  ──tail events──►  wgr-tail-collector  ──Loki push──►  <INGEST_DOMAIN>
                                    (Cloudflare Worker)
```

Each source Worker is registered once as a tail consumer of `wgr-tail-collector`. From then on, every `fetch()`/`scheduled()`/`queue()` invocation on that Worker emits a trace event → forwarded to Loki.

Each Worker shows up in Grafana with `app=<scriptName>`, `source=cf-worker`.

## Deploy

```bash
cd apps/wgr-tail-collector
npm install
wrangler login  # one-time
wrangler secret put WGR_INGEST_TOKEN
# (paste the same INGEST_AUTH_TOKEN used by the stack)

# Edit wrangler.toml: replace <INGEST_DOMAIN> placeholder with your real domain
wrangler deploy
```

After deploy, `wgr-tail-collector` is live on Cloudflare and reachable as a tail consumer.

## Register a source Worker

For each Worker whose logs you want to collect:

```bash
wrangler tail-consumer add <source-worker-name> wgr-tail-collector
```

Or add to that source Worker's `wrangler.toml`:
```toml
[[tail_consumers]]
service = "wgr-tail-collector"
```
Then redeploy the source Worker.

A helper script is provided:
```bash
bash scripts/cf-tail/add-target.sh <source-worker-name>
```

## Verify

In Grafana → Explore:
```logql
{source="cf-worker"}
{source="cf-worker", app="my-prod-worker"}
{source="cf-worker", outcome="exception"}
```

You should see one log line per `console.log` / `console.error` / unhandled exception in your source Workers.

## Tail this Worker itself

To debug the collector itself:
```bash
wrangler tail wgr-tail-collector
```

Lines starting with `[wgr-tail-collector]` indicate push failures (e.g. wrong token, network issue).

## Limitations

- Cloudflare tail events have inherent latency (5–30 s typically)
- Per-call payload capped by Cloudflare (~100 events per batch)
- The trace event itself doesn't include the response body, only `outcome`, `cpuTime`, `wallTime`, `logs`, `exceptions`
- For request bodies / paths / status codes, your source Worker must `console.log` them explicitly

## Local dev

```bash
wrangler dev
# Open another terminal:
wrangler tail wgr-tail-collector
```

Note: Workers in `wrangler dev` mode don't trigger tail consumers by default. To test the collector locally, you can simulate by POSTing a JSON payload to the dev URL.

## Files

```
apps/wgr-tail-collector/
├── src/index.ts          # the Worker handler
├── wrangler.toml         # config + tail_consumers wiring
├── package.json          # wrangler + workers-types
├── tsconfig.json
└── README.md             # this file
```
