# @wgr/logs-client

Typed client for the [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/) plus a tiny LogQL builder. Used by `wgr-logs-desk` and shippable to any other WGR app that pushes or queries logs.

## Install (workspace)

```json
{
  "dependencies": {
    "@wgr/logs-client": "workspace:*"
  }
}
```

## Usage

```ts
import { LokiClient, logql } from '@wgr/logs-client'

const client = new LokiClient({
  baseUrl: 'https://ingest.example.com',
  basicAuth: { username: 'wgr', password: process.env.INGEST_AUTH_TOKEN! }
})

// Push
await client.pushLine(
  { app: 'cron-runner', env: 'prod', level: 'info' },
  JSON.stringify({ msg: 'job done', duration_ms: 1342 })
)

// Query
const query = logql().app('cron-runner').env('prod').level('error').toString()
const res = await client.queryRange({
  query,
  start: Date.now() - 3600_000,
  end: Date.now(),
  limit: 200
})

// Tail (websocket URL only — open it from the desktop app)
const tailUrl = client.tailUrl(query, { delayFor: 5 })

// Active alerts (from Grafana Alertmanager)
const alerts = await client.activeAlerts('https://logs.example.com')
```
