#!/usr/bin/env bash
# wgr-logs-shipper entrypoint.
# Reads /config/sources.json, renders config.alloy from /opt/wgr-logs-shipper/modules,
# then execs alloy.

set -euo pipefail

CONFIG_PATH="${WGR_CONFIG_PATH:-/config/sources.json}"
RENDERED="${WGR_RENDERED_PATH:-/tmp/config.alloy}"
MODULES_DIR="/opt/wgr-logs-shipper/modules"
LIB_DIR="/opt/wgr-logs-shipper/lib"

log() { echo "[wgr-shipper] $*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

# --- Pre-flight checks --------------------------------------------------------
[[ -f "$CONFIG_PATH" ]] || fail "Config file not found: $CONFIG_PATH (mount /config/sources.json)"
[[ -n "${WGR_INGEST_TOKEN:-}" ]] || fail "WGR_INGEST_TOKEN env var is required"
command -v jq >/dev/null || fail "jq missing"

# --- Render config.alloy from sources.json -----------------------------------
log "Rendering $RENDERED from $CONFIG_PATH"
"$LIB_DIR/render.sh" "$CONFIG_PATH" "$MODULES_DIR" > "$RENDERED" \
  || fail "Render failed — see logs above"

log "Generated config.alloy ($(wc -l < "$RENDERED") lines)"

# Optional: dump rendered config to stderr for debugging when WGR_DEBUG=1
if [[ "${WGR_DEBUG:-0}" == "1" ]]; then
  log "--- BEGIN RENDERED CONFIG ---"
  cat "$RENDERED" >&2
  log "--- END RENDERED CONFIG ---"
fi

# --- Exec Alloy --------------------------------------------------------------
log "Starting Alloy"
exec /bin/alloy run "$RENDERED" \
  --server.http.listen-addr=0.0.0.0:12345 \
  --storage.path=/tmp/alloy-data \
  "$@"
