#!/usr/bin/env bash
# wgr-logs-shipper entrypoint.
#
# Two modes (auto-detected) :
#   - STATIC  : a /config/sources.json file is mounted → render once, exec alloy
#   - MANAGED : WGR_API_URL is set → enroll, poll API every 60s, reload alloy on change
#
# Required env (both modes) :
#   WGR_INGEST_TOKEN
#
# Static mode :
#   WGR_CONFIG_PATH (default /config/sources.json)
#
# Managed mode :
#   WGR_API_URL          (e.g. https://logs.example.com/mgmt)
#   WGR_REGISTER_TOKEN   (needed on first boot to enroll, can be unset afterward)
#   WGR_AGENT_NAME       (optional, defaults to hostname)
#   WGR_STATE_DIR        (default /state — should be mounted as a volume)
#   WGR_POLL_INTERVAL    (default 60 seconds)

set -euo pipefail

CONFIG_PATH="${WGR_CONFIG_PATH:-/config/sources.json}"
RENDERED="${WGR_RENDERED_PATH:-/tmp/config.alloy}"
MODULES_DIR="/opt/wgr-logs-shipper/modules"
LIB_DIR="/opt/wgr-logs-shipper/lib"
STATE_DIR="${WGR_STATE_DIR:-/state}"
POLL_INTERVAL="${WGR_POLL_INTERVAL:-60}"
SHIPPER_VERSION="0.1.0"

log()  { echo "[wgr-shipper] $*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

[[ -n "${WGR_INGEST_TOKEN:-}" ]] || fail "WGR_INGEST_TOKEN env var is required"

# ─── Mode detection ──────────────────────────────────────────────────────────
if [[ -n "${WGR_API_URL:-}" ]]; then
  MODE=managed
  API_URL="${WGR_API_URL%/}"
elif [[ -f "$CONFIG_PATH" ]]; then
  MODE=static
else
  fail "Either WGR_API_URL (managed) or $CONFIG_PATH (static) is required"
fi

log "Mode: $MODE"

# ─── STATIC mode : render once + exec ────────────────────────────────────────
if [[ "$MODE" == "static" ]]; then
  log "Rendering $RENDERED from $CONFIG_PATH"
  "$LIB_DIR/render.sh" "$CONFIG_PATH" "$MODULES_DIR" > "$RENDERED" \
    || fail "Render failed"
  log "Starting Alloy"
  exec /bin/alloy run "$RENDERED" \
    --server.http.listen-addr=0.0.0.0:12345 \
    --storage.path=/tmp/alloy-data \
    "$@"
fi

# ─── MANAGED mode ────────────────────────────────────────────────────────────
mkdir -p "$STATE_DIR"
AGENT_STATE="$STATE_DIR/agent.json"
ETAG_FILE="$STATE_DIR/last-etag"
LAST_ETAG=""
# Only restore last-etag if RENDERED exists (otherwise we'd think nothing changed
# while /tmp/config.alloy is empty after a container restart).
if [[ -f "$ETAG_FILE" && -s "$RENDERED" ]]; then
  LAST_ETAG=$(cat "$ETAG_FILE")
fi

# Enrol on first boot
if [[ ! -f "$AGENT_STATE" ]]; then
  [[ -n "${WGR_REGISTER_TOKEN:-}" ]] || fail "WGR_REGISTER_TOKEN required on first boot (no $AGENT_STATE)"
  AGENT_NAME="${WGR_AGENT_NAME:-$(hostname)}"
  log "First boot — registering as '$AGENT_NAME'"
  if ! curl -fsS -X POST -H "Content-Type: application/json" \
       --data "$(jq -nc \
         --arg name "$AGENT_NAME" \
         --arg hostname "$(hostname)" \
         --arg kind "docker" \
         --arg ver "$SHIPPER_VERSION" \
         --arg tok "$WGR_REGISTER_TOKEN" \
         '{name:$name, hostname:$hostname, shipper_kind:$kind, shipper_ver:$ver, register_token:$tok}')" \
       "$API_URL/agents/register" > "$AGENT_STATE.tmp"; then
    rm -f "$AGENT_STATE.tmp"
    fail "Registration failed"
  fi
  mv "$AGENT_STATE.tmp" "$AGENT_STATE"
  chmod 600 "$AGENT_STATE"
fi

AGENT_ID=$(jq -r '.agent_id' "$AGENT_STATE")
AGENT_TOKEN=$(jq -r '.agent_token' "$AGENT_STATE")
[[ -n "$AGENT_ID" && -n "$AGENT_TOKEN" && "$AGENT_ID" != "null" ]] || fail "Invalid $AGENT_STATE"
log "Agent ID: $AGENT_ID"

ALLOY_PID=""

# Fetch config from API, regen alloy config if etag changed.
# Returns 0 on success (even if nothing changed), 1 on network error.
fetch_and_render() {
  local resp etag
  if ! resp=$(curl -fsS -H "Authorization: Bearer $AGENT_TOKEN" \
                   "$API_URL/agents/$AGENT_ID/config" 2>&1); then
    log "Fetch failed: $resp"
    return 1
  fi
  etag=$(jq -r '.etag' <<<"$resp")
  if [[ -z "$etag" || "$etag" == "null" ]]; then
    log "API returned no etag, skipping"
    return 1
  fi
  if [[ "$etag" == "$LAST_ETAG" ]]; then
    return 0  # no change
  fi
  log "Config changed ($LAST_ETAG → $etag), regenerating"
  # Transform API response into renderer-compatible sources.json
  jq '.rendered | {defaults:{env, cluster, host}, sources}' <<<"$resp" \
    > "$STATE_DIR/sources.json"
  "$LIB_DIR/render.sh" "$STATE_DIR/sources.json" "$MODULES_DIR" > "$RENDERED"
  LAST_ETAG="$etag"
  echo "$etag" > "$ETAG_FILE"
  # Reload alloy if running
  if [[ -n "$ALLOY_PID" ]] && kill -0 "$ALLOY_PID" 2>/dev/null; then
    log "Reloading Alloy (SIGHUP)"
    kill -HUP "$ALLOY_PID" || true
  fi
  return 0
}

# Initial fetch (retry until success)
log "Fetching initial config..."
until fetch_and_render; do
  log "Retrying in 10s..."
  sleep 10
done

# If no sources yet (empty config), write minimal alloy config to keep the daemon alive
if [[ ! -s "$RENDERED" ]]; then
  cat > "$RENDERED" <<'EOF'
logging {
  level  = "info"
  format = "logfmt"
}

loki.write "wgr" {
  endpoint {
    url = sys.env("WGR_INGEST_URL")
    basic_auth {
      username = sys.env("WGR_INGEST_USER")
      password = sys.env("WGR_INGEST_TOKEN")
    }
  }
}
EOF
fi

# Trap signals to forward to alloy
shutdown() {
  log "Shutting down"
  if [[ -n "$ALLOY_PID" ]] && kill -0 "$ALLOY_PID" 2>/dev/null; then
    kill -TERM "$ALLOY_PID" 2>/dev/null || true
    wait "$ALLOY_PID" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown TERM INT

# Start Alloy in background
log "Starting Alloy (background) — polling every ${POLL_INTERVAL}s"
/bin/alloy run "$RENDERED" \
  --server.http.listen-addr=0.0.0.0:12345 \
  --storage.path=/tmp/alloy-data \
  "$@" &
ALLOY_PID=$!

# Polling loop
while true; do
  sleep "$POLL_INTERVAL"
  if ! kill -0 "$ALLOY_PID" 2>/dev/null; then
    log "Alloy process gone, exiting"
    exit 1
  fi
  fetch_and_render || true
done
