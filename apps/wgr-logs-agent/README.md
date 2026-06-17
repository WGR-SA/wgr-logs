# @wgr/wgr-logs-agent

CLI agent (Claude Agent SDK) qui installe et maintient le *shipper* `wgr-logs` sur n'importe quel serveur, et diagnostique les pannes de push — en SSH + API d'administration + Loki.

## Installation

```bash
npm install                 # depuis la racine du monorepo
npm run build:agent         # tsc → dist/
```

## Configuration

**Cibles** — `~/.wgr-logs-agent/targets.yml` :

```yaml
targets:
  - name: mutu-h2web287
    kind: php-mutu            # docker | bash | php-mutu
    ssh: { host: h2web287, user: uid188825, identityFile: ~/.ssh/infomaniak_rsa }
    publicDomain: example.ch
```

**Env** (validé au démarrage) :

**Auth Claude** : aucune clé n'est requise si tu es connecté via `claude` (abonnement Pro/Max) — le SDK réutilise ce login. Sinon, exporte `ANTHROPIC_API_KEY`. Pour un usage headless/CI sans login interactif : `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.

| Var | Usage |
|---|---|
| `ANTHROPIC_API_KEY` | optionnelle — sinon login abonnement `claude` |
| `WGR_API_URL` + `WGR_API_ADMIN_TOKEN` | appels admin API `/mgmt/*` |
| `WGR_API_REGISTER_TOKEN` | enrôlement (injecté côté outil, jamais exposé au modèle) |
| `WGR_INGEST_URL` + `WGR_INGEST_TOKEN` | requêtes Loki |
| `WGR_AGENT_MODEL` | override du modèle (défaut : opus-4-8 pour diagnose/repair, sonnet-4-6 pour install/refresh) |
| `WGR_AGENT_EFFORT` | `low\|medium\|high\|xhigh\|max` |

## Usage

```bash
wgr-logs-agent diagnose <target>                 # lecture seule
wgr-logs-agent install  <target>                 # dry-run par défaut
wgr-logs-agent install  <target> --live          # exécute (confirmation par mutation)
wgr-logs-agent install  <target> --live --yes    # exécute sans prompt (suppressions toujours confirmées)
wgr-logs-agent refresh  <target> --live
wgr-logs-agent repair   <target> --issue grpc-msg-too-large --live
```

## Sûreté

- L'agent n'agit **que** via les outils `mcp__wgr__*` ; les outils built-in (Bash/Write/… locaux) sont désactivés.
- Les mutations (ssh écriture, `ssh_put`, API non-GET) sont *gated* : `--dry-run` les refuse en décrivant l'action, sinon confirmation interactive. Les suppressions sont **toujours** confirmées.
- Les secrets (tokens) ne sont jamais loggés ni exposés au modèle (le register token est injecté côté outil).

## Tests

```bash
npm run test -w @wgr/wgr-logs-agent
```
