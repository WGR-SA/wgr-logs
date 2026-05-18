#!/usr/bin/env bash
# render.sh — JSON sources config → Alloy River config.
#
# Usage:
#   render.sh <sources.json> <modules_dir>
#
# Outputs the full config.alloy to stdout.
#
# Per-source the renderer picks <modules_dir>/<type>.alloy and replaces
# placeholders ({{INDEX}}, {{ENV}}, {{HOST}}, {{BASE_DIR}}, etc.) with values
# derived from the source entry + defaults.

set -euo pipefail

CONFIG="$1"
MODULES_DIR="$2"

[[ -f "$CONFIG" ]] || { echo "Config not found: $CONFIG" >&2; exit 1; }
[[ -d "$MODULES_DIR" ]] || { echo "Modules dir not found: $MODULES_DIR" >&2; exit 1; }

# Defaults
DEFAULT_ENV=$(jq -r '.defaults.env // "prod"' "$CONFIG")
DEFAULT_CLUSTER=$(jq -r '.defaults.cluster // "wgr-prod"' "$CONFIG")
DEFAULT_HOST=$(jq -r '.defaults.host // ""' "$CONFIG")
[[ -z "$DEFAULT_HOST" ]] && DEFAULT_HOST=$(hostname)

# Header
HEADER=$(<"$MODULES_DIR/_header.alloy")
HEADER=${HEADER//\{\{CLUSTER\}\}/$DEFAULT_CLUSTER}
echo "$HEADER"
echo ""

# Render each source
COUNT=$(jq '.sources | length' "$CONFIG")
for ((i = 0; i < COUNT; i++)); do
  TYPE=$(jq -r ".sources[$i].type" "$CONFIG")
  MODULE_FILE="$MODULES_DIR/${TYPE}.alloy"

  if [[ ! -f "$MODULE_FILE" ]]; then
    echo "// SKIPPED: unknown source type '$TYPE'" >&2
    continue
  fi

  # Per-source overrides for env/host, fallback to defaults
  ENV=$(jq -r ".sources[$i].env // \"$DEFAULT_ENV\"" "$CONFIG")
  HOST=$(jq -r ".sources[$i].host // \"$DEFAULT_HOST\"" "$CONFIG")

  CONTENT=$(<"$MODULE_FILE")
  CONTENT=${CONTENT//\{\{INDEX\}\}/$i}
  CONTENT=${CONTENT//\{\{ENV\}\}/$ENV}
  CONTENT=${CONTENT//\{\{HOST\}\}/$HOST}
  CONTENT=${CONTENT//\{\{CLUSTER\}\}/$DEFAULT_CLUSTER}

  case "$TYPE" in
    pm2)
      PATHV=$(jq -r ".sources[$i].path // \"/home/debian/.pm2/logs\"" "$CONFIG")
      CONTENT=${CONTENT//\{\{PATH\}\}/$PATHV}
      ;;

    cakephp|wordpress|prestashop)
      BASE_DIR=$(jq -r ".sources[$i].base_dir // \"/var/www\"" "$CONFIG")
      CONTENT=${CONTENT//\{\{BASE_DIR\}\}/$BASE_DIR}
      ;;

    nginx|journald|docker)
      # no extra placeholders
      ;;

    files)
      # Expand `paths` + `labels` into path_targets entries.
      TARGETS=$'\n'
      NPATHS=$(jq ".sources[$i].paths | length" "$CONFIG")
      for ((p = 0; p < NPATHS; p++)); do
        PATHV=$(jq -r ".sources[$i].paths[$p]" "$CONFIG")
        TARGETS+="    {"$'\n'
        TARGETS+="      __path__ = \"$PATHV\","$'\n'
        TARGETS+="      env      = \"$ENV\","$'\n'
        TARGETS+="      host     = \"$HOST\","$'\n'
        TARGETS+="      source   = \"files\","$'\n'

        # Custom labels (from sources[i].labels object)
        while IFS=$'\t' read -r KEY VAL; do
          [[ -z "$KEY" ]] && continue
          TARGETS+="      $KEY = \"$VAL\","$'\n'
        done < <(jq -r ".sources[$i].labels // {} | to_entries[] | \"\\(.key)\\t\\(.value)\"" "$CONFIG")

        TARGETS+="    },"$'\n'
      done
      # Strip trailing comma
      TARGETS="${TARGETS%,$'\n'}"$'\n'
      CONTENT=${CONTENT//\{\{TARGETS\}\}/$TARGETS}
      ;;
  esac

  echo "$CONTENT"
  echo ""
done
