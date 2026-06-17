#!/usr/bin/env bash
# wgr-logs install-shipper.sh
# Self-contained installer for Debian/Ubuntu VPS (no Docker required).
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/wgr-sa/wgr-logs/main/scripts/install-shipper.sh \
#     | sudo bash -s -- --api-url https://logs.example.com/mgmt \
#                       --register-token <REG> --ingest-token <INGEST> \
#                       --name vps-pm2-01
#
# Modes (auto-detected):
#   - managed : --api-url is set → enroll, poll API every 60s, reload alloy on change
#   - static  : --sources-file is set → render once, run alloy
#
# Uninstall:
#   sudo bash install-shipper.sh --uninstall

set -euo pipefail

# ─── Defaults & paths ─────────────────────────────────────────────────────────
MODE=""
TOKEN=""
INGEST_URL="https://ingest.example.com/loki/api/v1/push"
INGEST_USER="wgr"
API_URL=""
REGISTER_TOKEN=""
AGENT_NAME=""
ENV_NAME="prod"
POLL_INTERVAL=60
SOURCES_FILE=""
SHIPPER_VERSION="0.1.0"
UNINSTALL=0

ALLOY_CONFIG=/etc/alloy/config.alloy
ALLOY_MODULES=/etc/alloy/modules
ALLOY_ENV=/etc/alloy/.env
ALLOY_ENV_DROPIN=/etc/systemd/system/alloy.service.d/wgr-env.conf
WGR_STATE_DIR=/var/lib/wgr-shipper
WGR_BIN_DIR=/usr/local/bin
WGR_RENDER=$WGR_BIN_DIR/wgr-shipper-render
WGR_POLLER=$WGR_BIN_DIR/wgr-shipper-poll
WGR_POLLER_SVC=/etc/systemd/system/wgr-shipper-poll.service

# ─── Pretty output ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}▶${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✖${NC} $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Managed mode (recommended):
  --api-url URL          e.g. https://logs.example.com/mgmt
  --register-token TOK   one-time, only needed first install
  --ingest-token TOK     required, BasicAuth password for Loki
  --name NAME            optional, defaults to hostname
  --env ENV              defaults to "prod"
  --poll-interval SEC    defaults to 60

Static mode:
  --ingest-token TOK     required
  --sources-file PATH    path to sources.json

Common:
  --ingest-url URL       defaults to https://ingest.example.com/loki/api/v1/push
  --ingest-user USER     defaults to "wgr"
  --uninstall            stop services + remove files (keeps state)
  --help                 this message
EOF
}

# ─── Args parsing ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)        API_URL="$2"; shift 2 ;;
    --register-token) REGISTER_TOKEN="$2"; shift 2 ;;
    --ingest-token)   TOKEN="$2"; shift 2 ;;
    --ingest-url)     INGEST_URL="$2"; shift 2 ;;
    --ingest-user)    INGEST_USER="$2"; shift 2 ;;
    --name)           AGENT_NAME="$2"; shift 2 ;;
    --env)            ENV_NAME="$2"; shift 2 ;;
    --poll-interval)  POLL_INTERVAL="$2"; shift 2 ;;
    --sources-file)   SOURCES_FILE="$2"; shift 2 ;;
    --uninstall)      UNINSTALL=1; shift ;;
    --help|-h)        usage; exit 0 ;;
    *) fail "Unknown arg: $1 (see --help)" ;;
  esac
done

# ─── Sanity ───────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || fail "Must run as root (use sudo)"

if [[ $UNINSTALL -eq 1 ]]; then
  log "Uninstalling wgr-logs shipper"
  systemctl stop wgr-shipper-poll alloy 2>/dev/null || true
  systemctl disable wgr-shipper-poll 2>/dev/null || true
  rm -f "$WGR_POLLER_SVC" "$WGR_POLLER" "$WGR_RENDER" "$ALLOY_ENV_DROPIN"
  rm -rf "$ALLOY_MODULES" "$ALLOY_CONFIG"
  systemctl daemon-reload
  warn "Alloy package and $WGR_STATE_DIR (agent token) are kept. Run apt purge alloy + rm -rf $WGR_STATE_DIR for full cleanup."
  exit 0
fi

[[ -n "$TOKEN" ]] || fail "--ingest-token is required"
if [[ -n "$API_URL" ]]; then
  MODE=managed
elif [[ -n "$SOURCES_FILE" ]]; then
  MODE=static
  [[ -f "$SOURCES_FILE" ]] || fail "Sources file not found: $SOURCES_FILE"
else
  fail "Either --api-url (managed) or --sources-file (static) is required"
fi
log "Mode: $MODE"

# ─── Install deps ─────────────────────────────────────────────────────────────
install_deps() {
  log "Installing deps (jq, curl, gnupg, acl, apt-transport-https)"
  apt-get update -qq
  apt-get install -y -qq jq curl gnupg acl apt-transport-https ca-certificates >/dev/null
}

install_alloy() {
  if command -v alloy >/dev/null 2>&1; then
    log "Alloy already installed: $(alloy --version 2>&1 | head -1)"
    return
  fi
  log "Installing Grafana Alloy from official apt repo"
  install -d /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
  chmod a+r /etc/apt/keyrings/grafana.gpg
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    > /etc/apt/sources.list.d/grafana.list
  apt-get update -qq
  apt-get install -y -qq alloy >/dev/null
}

# ─── Write modules + render.sh (extracted from heredocs at the end) ──────────
write_modules() {
  log "Writing Alloy modules to $ALLOY_MODULES"
  install -d "$ALLOY_MODULES"
  awk '/^# >>> MODULE_BEGIN [^ ]+ <<</{ name=$4; outfile="'"$ALLOY_MODULES"'/" name; next }
       /^# >>> MODULE_END <<</{ outfile=""; next }
       outfile { print > outfile }' "$0"
}

write_render() {
  log "Writing render script to $WGR_RENDER"
  awk '/^# >>> RENDER_BEGIN <<</{ inblk=1; next }
       /^# >>> RENDER_END <<</{ inblk=0; next }
       inblk' "$0" > "$WGR_RENDER"
  chmod +x "$WGR_RENDER"
}

# ─── Write env file (systemd EnvironmentFile) ────────────────────────────────
write_env() {
  log "Writing env file to $ALLOY_ENV"
  install -d -m 0750 "$(dirname "$ALLOY_ENV")"
  cat > "$ALLOY_ENV" <<EOF
WGR_INGEST_URL=$INGEST_URL
WGR_INGEST_USER=$INGEST_USER
WGR_INGEST_TOKEN=$TOKEN
EOF
  chmod 600 "$ALLOY_ENV"

  install -d "$(dirname "$ALLOY_ENV_DROPIN")"
  cat > "$ALLOY_ENV_DROPIN" <<EOF
[Service]
EnvironmentFile=$ALLOY_ENV
EOF
}

# ─── Managed-mode: register + write poller ───────────────────────────────────
setup_managed() {
  install -d -m 0700 "$WGR_STATE_DIR"

  if [[ ! -f "$WGR_STATE_DIR/agent.json" ]]; then
    [[ -n "$REGISTER_TOKEN" ]] || fail "--register-token required on first install (no $WGR_STATE_DIR/agent.json)"
    local name
    name="${AGENT_NAME:-$(hostname)}"
    log "Registering agent '$name' with API"
    local body
    body=$(jq -nc \
      --arg name "$name" \
      --arg hostname "$(hostname)" \
      --arg kind "bash" \
      --arg ver "$SHIPPER_VERSION" \
      --arg env "$ENV_NAME" \
      --arg tok "$REGISTER_TOKEN" \
      '{name:$name, hostname:$hostname, shipper_kind:$kind, shipper_ver:$ver, env:$env, register_token:$tok}')
    if ! curl -fsS -X POST -H "Content-Type: application/json" --data "$body" \
         "$API_URL/agents/register" > "$WGR_STATE_DIR/agent.json.tmp"; then
      rm -f "$WGR_STATE_DIR/agent.json.tmp"
      fail "Registration failed"
    fi
    mv "$WGR_STATE_DIR/agent.json.tmp" "$WGR_STATE_DIR/agent.json"
    chmod 600 "$WGR_STATE_DIR/agent.json"
  else
    log "Reusing existing agent.json (token already obtained)"
  fi

  log "Writing poller script to $WGR_POLLER"
  cat > "$WGR_POLLER" <<EOF
#!/usr/bin/env bash
# wgr-shipper-poll — fetch config from API, regen alloy.config, reload alloy on change.
set -euo pipefail
API_URL="$API_URL"
STATE_DIR="$WGR_STATE_DIR"
MODULES="$ALLOY_MODULES"
RENDERER="$WGR_RENDER"
CONFIG="$ALLOY_CONFIG"
POLL=${POLL_INTERVAL}
EOF
  cat >> "$WGR_POLLER" <<'EOF'
AGENT_ID=$(jq -r '.agent_id' "$STATE_DIR/agent.json")
AGENT_TOKEN=$(jq -r '.agent_token' "$STATE_DIR/agent.json")
ETAG_FILE="$STATE_DIR/last-etag"
LAST_ETAG=""
[[ -f "$ETAG_FILE" && -s "$CONFIG" ]] && LAST_ETAG=$(cat "$ETAG_FILE")

while true; do
  if resp=$(curl -fsS --max-time 15 -H "Authorization: Bearer $AGENT_TOKEN" \
              "$API_URL/agents/$AGENT_ID/config"); then
    etag=$(jq -r '.etag' <<<"$resp")
    if [[ -n "$etag" && "$etag" != "null" && "$etag" != "$LAST_ETAG" ]]; then
      echo "[wgr-poll] Config changed ($LAST_ETAG → $etag)"
      jq '.rendered | {defaults:{env, cluster, host}, sources}' <<<"$resp" \
        > "$STATE_DIR/sources.json"
      if "$RENDERER" "$STATE_DIR/sources.json" "$MODULES" > "$CONFIG.tmp"; then
        mv "$CONFIG.tmp" "$CONFIG"
        systemctl reload alloy 2>/dev/null || systemctl restart alloy
        LAST_ETAG="$etag"
        echo "$etag" > "$ETAG_FILE"
        echo "[wgr-poll] Alloy reloaded"
      else
        echo "[wgr-poll] Render failed, keeping previous config" >&2
        rm -f "$CONFIG.tmp"
      fi
    fi
  else
    echo "[wgr-poll] Fetch failed, will retry" >&2
  fi
  sleep "$POLL"
done
EOF
  chmod +x "$WGR_POLLER"

  log "Writing systemd service $WGR_POLLER_SVC"
  cat > "$WGR_POLLER_SVC" <<EOF
[Unit]
Description=wgr-logs shipper poller (fetches config from $API_URL)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$WGR_POLLER
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF
}

# ─── Static mode: copy sources.json + render once ────────────────────────────
setup_static() {
  log "Copying sources file"
  install -d "$WGR_STATE_DIR"
  cp "$SOURCES_FILE" "$WGR_STATE_DIR/sources.json"
  log "Rendering initial config"
  "$WGR_RENDER" "$WGR_STATE_DIR/sources.json" "$ALLOY_MODULES" > "$ALLOY_CONFIG"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
install_deps
install_alloy
write_modules
write_render
write_env

if [[ "$MODE" == "managed" ]]; then
  setup_managed
  # Empty initial config so alloy starts (poller will populate within seconds)
  if [[ ! -s "$ALLOY_CONFIG" ]]; then
    cat > "$ALLOY_CONFIG" <<'EOF'
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
else
  setup_static
fi

log "Reload systemd + enable services"
systemctl daemon-reload
systemctl enable alloy >/dev/null
systemctl restart alloy
if [[ "$MODE" == "managed" ]]; then
  systemctl enable wgr-shipper-poll >/dev/null
  systemctl restart wgr-shipper-poll
fi

sleep 3
if systemctl is-active --quiet alloy; then
  log "Alloy is running"
else
  warn "Alloy not running, see: journalctl -u alloy -n 30"
fi
if [[ "$MODE" == "managed" ]]; then
  if systemctl is-active --quiet wgr-shipper-poll; then
    log "Poller is running (interval ${POLL_INTERVAL}s)"
  else
    warn "Poller not running, see: journalctl -u wgr-shipper-poll -n 30"
  fi
fi

log "Done."
if [[ "$MODE" == "managed" ]]; then
  log "Your agent will appear in the desktop UI within ${POLL_INTERVAL}s."
  log "Add sources via the UI, the shipper will apply them automatically."
fi

# Stop processing here. The remainder of the file is module data extracted by awk
# from the literal bytes between MODULE_BEGIN/MODULE_END markers. Wrapped in a
# do-nothing heredoc so `bash -n` (syntax check) ignores its content.
exit 0

: <<'__WGR_EMBEDDED_DATA__'

# ═════════════════════════════════════════════════════════════════════════════
# EMBEDDED ALLOY MODULES (extracted by write_modules at install time)
# ═════════════════════════════════════════════════════════════════════════════

# >>> MODULE_BEGIN _header.alloy <<<
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
  external_labels = {
    cluster = "{{CLUSTER}}",
  }
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN pm2.alloy <<<
local.file_match "pm2_{{INDEX}}" {
  path_targets = [
    {
      __path__ = "{{PATH}}/*.log",
      env      = "{{ENV}}",
      host     = "{{HOST}}",
      source   = "pm2",
    },
  ]
}

loki.process "pm2_{{INDEX}}" {
  forward_to = [loki.write.wgr.receiver]

  stage.regex {
    expression = ".*/(?P<app>.+)-(?P<stream>out|error)\\.log$"
    source     = "filename"
  }
  stage.labels {
    values = { app = "", stream = "" }
  }
  stage.match {
    selector = "{stream=\"error\"}"
    stage.static_labels { values = { level = "error" } }
  }
  stage.match {
    selector = "{stream=\"out\"}"
    stage.static_labels { values = { level = "info" } }
  }
  stage.json { expressions = { json_level = "level" } }
  stage.labels { values = { level = "json_level" } }
}

loki.source.file "pm2_{{INDEX}}" {
  targets       = local.file_match.pm2_{{INDEX}}.targets
  forward_to    = [loki.process.pm2_{{INDEX}}.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN cakephp.alloy <<<
local.file_match "cakephp_{{INDEX}}" {
  path_targets = [
    { __path__ = "{{BASE_DIR}}/*/logs/*.log",          env = "{{ENV}}", host = "{{HOST}}", source = "cakephp" },
    { __path__ = "{{BASE_DIR}}/*/app/tmp/logs/*.log",  env = "{{ENV}}", host = "{{HOST}}", source = "cakephp" },
  ]
}

loki.process "cakephp_{{INDEX}}" {
  forward_to = [loki.write.wgr.receiver]

  // Group multi-line entries (timestamped header + stack trace / Request URL /
  // Referer URL) into a single event. A new event starts on a timestamp prefix.
  stage.multiline {
    firstline     = "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}"
    max_wait_time = "3s"
    max_lines     = 512
  }

  stage.regex {
    expression = ".*/(?P<app>[^/]+)/(?:logs|app/tmp/logs)/(?P<log_type>[a-z][a-z0-9-]*)\\.log$"
    source     = "filename"
  }
  stage.labels { values = { app = "", log_type = "" } }
  stage.json { expressions = { json_level = "level" } }
  stage.labels { values = { level = "json_level" } }
  stage.match {
    selector = "{level=\"\", log_type=\"error\"}"
    stage.static_labels { values = { level = "error" } }
  }
  stage.match {
    selector = "{level=\"\", log_type=\"cli-error\"}"
    stage.static_labels { values = { level = "error" } }
  }
  stage.match {
    selector = "{level=\"\", log_type=\"debug\"}"
    stage.static_labels { values = { level = "debug" } }
  }
  stage.match {
    selector = "{level=\"\", log_type=\"queries\"}"
    stage.static_labels { values = { level = "info" } }
  }
}

loki.source.file "cakephp_{{INDEX}}" {
  targets       = local.file_match.cakephp_{{INDEX}}.targets
  forward_to    = [loki.process.cakephp_{{INDEX}}.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN wordpress.alloy <<<
local.file_match "wordpress_{{INDEX}}" {
  path_targets = [
    { __path__ = "{{BASE_DIR}}/*/wp-content/debug.log", env = "{{ENV}}", host = "{{HOST}}", source = "wordpress" },
  ]
}

loki.process "wordpress_{{INDEX}}" {
  forward_to = [loki.write.wgr.receiver]
  stage.regex {
    expression = ".*/(?P<app>[^/]+)/wp-content/debug\\.log$"
    source = "filename"
  }
  stage.labels { values = { app = "" } }
}

loki.source.file "wordpress_{{INDEX}}" {
  targets       = local.file_match.wordpress_{{INDEX}}.targets
  forward_to    = [loki.process.wordpress_{{INDEX}}.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN prestashop.alloy <<<
local.file_match "prestashop_{{INDEX}}" {
  path_targets = [
    { __path__ = "{{BASE_DIR}}/*/var/logs/*.log", env = "{{ENV}}", host = "{{HOST}}", source = "prestashop" },
    { __path__ = "{{BASE_DIR}}/*/log/*.log",      env = "{{ENV}}", host = "{{HOST}}", source = "prestashop" },
  ]
}

loki.process "prestashop_{{INDEX}}" {
  forward_to = [loki.write.wgr.receiver]
  stage.regex {
    expression = ".*/(?P<app>[^/]+)/(?:var/logs|log)/(?P<log_file>[a-z0-9][a-z0-9_-]*)\\.log$"
    source = "filename"
  }
  stage.labels { values = { app = "", log_file = "" } }
  stage.json { expressions = { json_level = "level_name" } }
  stage.labels { values = { level = "json_level" } }
}

loki.source.file "prestashop_{{INDEX}}" {
  targets       = local.file_match.prestashop_{{INDEX}}.targets
  forward_to    = [loki.process.prestashop_{{INDEX}}.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN nginx.alloy <<<
local.file_match "nginx_{{INDEX}}_access" {
  path_targets = [{ __path__ = "/var/log/nginx/access.log", app="nginx", env="{{ENV}}", host="{{HOST}}", source="nginx", stream="access" }]
}
local.file_match "nginx_{{INDEX}}_error" {
  path_targets = [{ __path__ = "/var/log/nginx/error.log",  app="nginx", env="{{ENV}}", host="{{HOST}}", source="nginx", stream="error", level="error" }]
}
loki.source.file "nginx_{{INDEX}}_access" {
  targets       = local.file_match.nginx_{{INDEX}}_access.targets
  forward_to    = [loki.write.wgr.receiver]
  tail_from_end = false
}
loki.source.file "nginx_{{INDEX}}_error" {
  targets       = local.file_match.nginx_{{INDEX}}_error.targets
  forward_to    = [loki.write.wgr.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN journald.alloy <<<
discovery.relabel "systemd_{{INDEX}}" {
  targets = []
  rule {
    source_labels = ["__journal__systemd_unit"]
    target_label  = "unit"
  }
  rule {
    source_labels = ["__journal__hostname"]
    target_label  = "host"
  }
  rule {
    source_labels = ["__journal_priority_keyword"]
    target_label  = "level"
  }
}

loki.source.journal "systemd_{{INDEX}}" {
  max_age       = "12h"
  path          = "/run/log/journal"
  relabel_rules = discovery.relabel.systemd_{{INDEX}}.rules
  forward_to    = [loki.write.wgr.receiver]
  labels        = { job = "systemd-journal", env = "{{ENV}}", source = "journald" }
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN docker.alloy <<<
discovery.docker "containers_{{INDEX}}" {
  host = "unix:///var/run/docker.sock"
}

loki.source.docker "docker_{{INDEX}}" {
  host          = "unix:///var/run/docker.sock"
  targets       = discovery.docker.containers_{{INDEX}}.targets
  forward_to    = [loki.write.wgr.receiver]
  labels        = { env = "{{ENV}}", host = "{{HOST}}", source = "docker" }
}
# >>> MODULE_END <<<

# >>> MODULE_BEGIN files.alloy <<<
local.file_match "files_{{INDEX}}" {
  path_targets = [{{TARGETS}}]
}

loki.process "files_{{INDEX}}" {
  forward_to = [loki.write.wgr.receiver]
  stage.json { expressions = { json_level = "level" } }
  stage.labels { values = { level = "json_level" } }
}

loki.source.file "files_{{INDEX}}" {
  targets       = local.file_match.files_{{INDEX}}.targets
  forward_to    = [loki.process.files_{{INDEX}}.receiver]
  tail_from_end = false
}
# >>> MODULE_END <<<

# >>> RENDER_BEGIN <<<
#!/usr/bin/env bash
# wgr-shipper-render — JSON sources config → Alloy River config.
# Same logic as the Docker shipper's lib/render.sh.
set -euo pipefail
CONFIG="$1"
MODULES_DIR="$2"
[[ -f "$CONFIG" ]] || { echo "Config not found: $CONFIG" >&2; exit 1; }
[[ -d "$MODULES_DIR" ]] || { echo "Modules dir not found: $MODULES_DIR" >&2; exit 1; }

DEFAULT_ENV=$(jq -r '.defaults.env // "prod"' "$CONFIG")
DEFAULT_CLUSTER=$(jq -r '.defaults.cluster // "wgr-prod"' "$CONFIG")
DEFAULT_HOST=$(jq -r '.defaults.host // ""' "$CONFIG")
[[ -z "$DEFAULT_HOST" ]] && DEFAULT_HOST=$(hostname)

HEADER=$(<"$MODULES_DIR/_header.alloy")
HEADER=${HEADER//\{\{CLUSTER\}\}/$DEFAULT_CLUSTER}
echo "$HEADER"; echo ""

COUNT=$(jq '.sources | length' "$CONFIG")
for ((i = 0; i < COUNT; i++)); do
  TYPE=$(jq -r ".sources[$i].type" "$CONFIG")
  MODULE_FILE="$MODULES_DIR/${TYPE}.alloy"
  [[ -f "$MODULE_FILE" ]] || { echo "// SKIPPED: unknown type '$TYPE'" >&2; continue; }
  ENV=$(jq -r ".sources[$i].config.env // \"$DEFAULT_ENV\"" "$CONFIG")
  HOST=$(jq -r ".sources[$i].config.host // \"$DEFAULT_HOST\"" "$CONFIG")
  CONTENT=$(<"$MODULE_FILE")
  CONTENT=${CONTENT//\{\{INDEX\}\}/$i}
  CONTENT=${CONTENT//\{\{ENV\}\}/$ENV}
  CONTENT=${CONTENT//\{\{HOST\}\}/$HOST}
  CONTENT=${CONTENT//\{\{CLUSTER\}\}/$DEFAULT_CLUSTER}
  case "$TYPE" in
    pm2)
      PATHV=$(jq -r ".sources[$i].config.path // \"/home/debian/.pm2/logs\"" "$CONFIG")
      CONTENT=${CONTENT//\{\{PATH\}\}/$PATHV}
      ;;
    cakephp|wordpress|prestashop)
      BASE_DIR=$(jq -r ".sources[$i].config.base_dir // \"/var/www\"" "$CONFIG")
      CONTENT=${CONTENT//\{\{BASE_DIR\}\}/$BASE_DIR}
      ;;
    files)
      TARGETS=$'\n'
      NPATHS=$(jq ".sources[$i].config.paths | length" "$CONFIG")
      for ((p = 0; p < NPATHS; p++)); do
        PATHV=$(jq -r ".sources[$i].config.paths[$p]" "$CONFIG")
        TARGETS+="    {"$'\n'
        TARGETS+="      __path__ = \"$PATHV\","$'\n'
        TARGETS+="      env      = \"$ENV\","$'\n'
        TARGETS+="      host     = \"$HOST\","$'\n'
        TARGETS+="      source   = \"files\","$'\n'
        while IFS=$'\t' read -r KEY VAL; do
          [[ -z "$KEY" ]] && continue
          TARGETS+="      $KEY = \"$VAL\","$'\n'
        done < <(jq -r ".sources[$i].config.labels // {} | to_entries[] | \"\\(.key)\\t\\(.value)\"" "$CONFIG")
        TARGETS+="    },"$'\n'
      done
      CONTENT=${CONTENT//\{\{TARGETS\}\}/$TARGETS}
      ;;
  esac
  echo "$CONTENT"; echo ""
done
# >>> RENDER_END <<<
__WGR_EMBEDDED_DATA__
