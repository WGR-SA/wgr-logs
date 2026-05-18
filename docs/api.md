# API reference — `wgr-logs-api`

Référence des endpoints du service NestJS exposé sur `https://<LOGS_DOMAIN>/mgmt`.

## Auth

3 rôles. Chacun a son token.

| Rôle | Header | Token | Endpoints |
|---|---|---|---|
| Admin | `Authorization: Bearer <ADMIN_TOKEN>` | `WGR_API_ADMIN_TOKEN` du `.env` | Tous sauf `/agents/register` |
| Agent | `Authorization: Bearer <AGENT_TOKEN>` | Généré au register, stocké sur le shipper | `/agents/:id/config` + `/agents/:id/heartbeat` |
| Register | dans le body `register_token` | `WGR_API_REGISTER_TOKEN` du `.env` | `/agents/register` uniquement |

Endpoints non-listés ici → 401.

## Health & metadata

### `GET /mgmt/health`

Aucun auth. Test que l'API + DB répondent.

```json
{ "status": "ok", "database": "ok" }
```

### `GET /mgmt/source-types`

Auth admin. Catalogue des types de sources avec leur JSON schema (utilisé par la UI pour générer les formulaires).

```json
{
  "definitions": {
    "pm2":      { "title": "PM2", "icon": "i-lucide-cpu", "type": "object", "required": ["type","path"], "properties": {...} },
    "cakephp":  { ... },
    "wordpress":{ ... },
    "prestashop":{ ... },
    "nginx":    { ... },
    "journald": { ... },
    "docker":   { ... },
    "files":    { ... }
  }
}
```

## Enrôlement

### `POST /mgmt/agents/register`

Aucune auth header. Le `register_token` du body sert d'auth one-time. Appelé une fois par un shipper au premier boot.

**Request**:
```json
{
  "name": "vps-pm2-01",
  "hostname": "pm2-debian",
  "shipper_kind": "bash",       // docker | bash | php | cf-tail | browser | unknown
  "shipper_ver": "0.1.0",
  "env": "prod",
  "register_token": "<WGR_API_REGISTER_TOKEN>"
}
```

**Response 201**:
```json
{
  "agent_id": "08e1fed1-f5ff-4f11-b95e-61d39cafc420",
  "agent_token": "e89d48c788aa5a1c3c737bf9b98919b632c3c97ea8e091e6",
  "status": "pending"
}
```

`agent_token` n'est **jamais** stocké en clair côté serveur (bcrypt hash). Le client doit le sauver localement.

Erreurs : 401 si register_token invalide.

## Endpoints admin (CRUD agents)

### `GET /mgmt/agents`

Liste tous les agents avec leurs sources.

```json
[
  {
    "id": "08e1...",
    "name": "vps-pm2-01",
    "hostname": "pm2-debian",
    "env": "prod",
    "cluster": "wgr-prod",
    "shipperKind": "bash",
    "shipperVer": "0.1.0",
    "status": "active",
    "lastSeen": "2026-05-18T17:24:08.080Z",
    "createdAt": "...",
    "updatedAt": "...",
    "sources": [
      { "id": 1, "type": "pm2", "config": {"path":"/home/debian/.pm2/logs"}, "enabled": true, "position": 0, ... }
    ]
  }
]
```

Note : `tokenHash` est exclu de la réponse via `@Exclude()` (vérifié par tests).

### `GET /mgmt/agents/:id`

Détail d'un agent + ses sources. 404 si inconnu.

### `PUT /mgmt/agents/:id`

Met à jour un agent (renommer, changer env, désactiver…).

**Request**:
```json
{
  "name": "nouveau-nom",         // optionnel
  "env": "staging",              // optionnel
  "cluster": "wgr-staging",      // optionnel
  "status": "disabled"           // pending | active | disabled
}
```

### `DELETE /mgmt/agents/:id`

Supprime l'agent + cascade les sources + config_versions. **204** si OK, **404** si inconnu.

## Sources d'un agent (CRUD)

### `GET /mgmt/agents/:agentId/sources`

Liste les sources d'un agent.

### `POST /mgmt/agents/:agentId/sources`

Ajoute une source. Le `config` doit être conforme au JSON schema du type (cf. `/mgmt/source-types`).

**Request**:
```json
{
  "type": "pm2",
  "config": { "path": "/home/debian/.pm2/logs" },
  "enabled": true,         // défaut true
  "position": 0            // défaut 0, pour ordering
}
```

Exemples par type :
```jsonc
{ "type": "pm2",        "config": { "path": "/home/debian/.pm2/logs" } }
{ "type": "cakephp",    "config": { "base_dir": "/var/www" } }
{ "type": "wordpress",  "config": { "base_dir": "/var/www" } }
{ "type": "prestashop", "config": { "base_dir": "/var/www" } }
{ "type": "nginx",      "config": {} }
{ "type": "journald",   "config": {} }
{ "type": "docker",     "config": {} }
{ "type": "files",      "config": { "paths": ["/var/log/myapp/*.log"], "labels": {"app":"myapp"} } }
```

### `PUT /mgmt/agents/:agentId/sources/:sourceId`

Met à jour une source (changer la config, toggle enabled, repositionner).

**Request** (tout est optionnel) :
```json
{
  "config": { ... },
  "enabled": false,
  "position": 1
}
```

### `DELETE /mgmt/agents/:agentId/sources/:sourceId`

Supprime la source. **204**.

## Endpoints agent (poll par le shipper)

### `GET /mgmt/agents/:id/config`

Auth = Bearer `agent_token`. Renvoie la config rendue + un ETag déterministe pour détecter les changements.

**Response**:
```json
{
  "etag": "5b98abf56669982b",
  "rendered": {
    "agent_id": "08e1...",
    "env": "prod",
    "cluster": "wgr-prod",
    "host": "pm2-debian",
    "sources": [
      { "type": "pm2",     "config": {"path":"/home/debian/.pm2/logs"}, "enabled": true, "position": 0 },
      { "type": "journald","config": {},                                 "enabled": true, "position": 0 }
    ]
  }
}
```

**Side effects**:
- `agent.last_seen` ← maintenant
- Si `status=pending` → bascule à `active`
- Si l'ETag n'existe pas encore dans `config_versions`, le snapshot est persisté (audit)

Le shipper compare avec son ETag local et reload Alloy seulement si diff.

### `POST /mgmt/agents/:id/heartbeat`

Auth = Bearer `agent_token`. Pour les shippers qui n'appellent pas `/config` (rare). Met à jour `last_seen`.

**Request** (tout est optionnel) :
```json
{
  "hostname": "actual-vps-hostname",
  "shipper_ver": "0.1.1"
}
```

**Response**:
```json
{ "ok": true }
```

## Exemples curl

### Lister les agents (admin)

```bash
curl -s -H "Authorization: Bearer $ADMIN" \
  https://<LOGS_DOMAIN>/mgmt/agents | jq .
```

### Ajouter une source PM2

```bash
curl -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"type":"pm2","config":{"path":"/home/debian/.pm2/logs"}}' \
  https://<LOGS_DOMAIN>/mgmt/agents/$AGENT_ID/sources
```

### Forcer un reload (admin)

Pas de endpoint dédié pour ça. Le shipper poll toutes les 60s. Pour forcer immédiatement :
- Éditer une source (toggle enabled → toggle back) pour générer un nouvel ETag
- OU sur le shipper : `kill -HUP $(pgrep alloy)` (Docker) ou `systemctl reload alloy` (bash)

### Désactiver temporairement un agent

```bash
curl -X PUT -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"status":"disabled"}' https://<LOGS_DOMAIN>/mgmt/agents/$AGENT_ID
```

Le shipper continuera de poll mais on peut filtrer côté UI. Pour stopper complètement, il faut désinstaller le shipper côté serveur.

## Voir aussi

- [`architecture.md`](architecture.md) — flux complet enrolement + polling
- [`shipper-docker.md`](shipper-docker.md), [`shipper-bash.md`](shipper-bash.md), [`shipper-php.md`](shipper-php.md) — guides shippers
