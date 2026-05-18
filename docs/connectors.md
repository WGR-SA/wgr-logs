# Brancher une source à wgr-logs

Tous les connecteurs poussent sur `https://<INGEST_DOMAIN>/loki/api/v1/push` avec un Bearer token (`INGEST_AUTH_TOKEN`). Le token est partagé pour toutes les sources, distinct du mot de passe Grafana.

## Règles de labels

**Cardinalité faible obligatoire.** Bons labels : `app`, `env`, `host`, `level`, `service`, `cluster`. **JAMAIS** : `user_id`, `request_id`, `trace_id`, `path` complet, `ip` — ils explosent l'index Loki. Mets-les dans la ligne JSON, ils restent grep-ables via LogQL.

---

## 1. Apps Docker (driver natif Loki) — le plus simple

### Pré-requis (une seule fois sur l'host Docker)

```bash
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
```

### Dans n'importe quel `docker-compose.yml`

```yaml
services:
  monapp:
    image: monimage:latest
    logging:
      driver: loki
      options:
        loki-url: "https://<INGEST_DOMAIN>/loki/api/v1/push"
        loki-batch-size: "400"
        loki-retries: "3"
        loki-external-labels: "app=monapp,env=prod,host={{.Name}}"
        loki-pipeline-stages: |
          - json:
              expressions:
                level: level
                msg: msg
          - labels:
              level:
```

Côté app (Nuxt, Strapi, NestJS), log en **JSON sur stdout** (pino, winston, ou `console.log(JSON.stringify({...}))`). Le pipeline ci-dessus extrait `level` automatiquement.

### Auth Bearer

Le driver Loki ne supporte pas Bearer nativement, mais accepte BasicAuth. Sur Traefik côté serveur, on convertit BasicAuth → header :

```yaml
loki-url: "https://wgr:${INGEST_AUTH_TOKEN}@<INGEST_DOMAIN>/loki/api/v1/push"
```

(Voir `docker-compose.yml` racine pour le middleware Traefik `ingest-auth`.)

---

## 2. Serveur Linux infra (Alloy)

Sur le VPS lui-même, Alloy tourne dans la stack et lit `/var/log/*` + `/run/log/journal` montés en volume read-only. Rien à faire de plus pour l'host courant.

### Sur un autre serveur (deuxième VPS, etc.)

```bash
# Debian/Ubuntu
sudo apt install -y wget gpg
wget -qO - https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt update && sudo apt install -y alloy
```

Puis copier `docker/alloy/config.alloy` vers `/etc/alloy/config.alloy` en remplaçant l'endpoint :

```river
loki.write "default" {
  endpoint {
    url = "https://<INGEST_DOMAIN>/loki/api/v1/push"
    basic_auth {
      username = "wgr"
      password = sys.env("INGEST_AUTH_TOKEN")
    }
  }
}
```

`sudo systemctl enable --now alloy`

---

## 3. Cloudflare Workers (Tail Worker)

Pas d'agent possible dans un Worker — on relaie via un **Tail Consumer Worker** dédié.

### Worker `cf-worker-logs-tail` (squelette)

`wrangler.toml` :
```toml
name = "cf-worker-logs-tail"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[[tail_consumers]]
service = "monsite-prod"   # le Worker dont on collecte les logs

[vars]
LOKI_URL = "https://<INGEST_DOMAIN>/loki/api/v1/push"
APP = "monsite"
ENV = "prod"
# INGEST_AUTH_TOKEN ajouté via `wrangler secret put`
```

`src/index.ts` :
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

Déploiement :
```bash
wrangler secret put INGEST_AUTH_TOKEN
wrangler deploy
```

À répéter par Worker source (1 tail consumer = 1 source). Ou rendre le tail consumer générique via `tail_consumers` multiples.

---

## 4. App Tauri (wgr-clip, wgr-logs-desk en prod)

Pour collecter les erreurs côté utilisateur (opt-in) :

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
        stream: { app: 'wgr-clip', env: 'prod', level, source: 'desktop' },
        values: [[ts, JSON.stringify({ msg, ...ctx })]]
      }]
    })
  })
}
```

Le token est fourni via une URL signée temporaire (côté backend) ou via update server, **jamais en clair dans le bundle**.

---

## 5. Endpoint browser (sites statiques, erreurs JS)

Petit Worker proxy dédié qui accepte CORS et forward vers Loki avec validation (rate limit + sample). Pattern proche du #3 mais déclenché par `fetch()` côté navigateur sur `error.window`.

---

## Vérification rapide

Après avoir branché une source, vérifier dans Grafana → Explore :

```logql
{app="ton-app"} | last 5m
```

Si rien n'apparaît, check :
1. `docker plugin ls` (driver Loki actif)
2. `curl -I https://<INGEST_DOMAIN>/ready` (HTTP 200)
3. `docker logs <ton-service>` (erreurs du driver Loki affichées en stderr)
