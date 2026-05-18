#!/usr/bin/env bash
# add-target.sh — register a Worker as a source for wgr-tail-collector.
#
# Usage:
#   bash add-target.sh <source-worker-name>
#
# Equivalent to: `wrangler tail-consumer add <source-worker-name> wgr-tail-collector`
# but also prints the alternative wrangler.toml snippet for git-tracked workflows.

set -euo pipefail

TARGET="${1:-}"
CONSUMER="wgr-tail-collector"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <source-worker-name>" >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "ERROR: wrangler not installed. Run: npm install -g wrangler" >&2
  exit 1
fi

echo "▶ Adding '$CONSUMER' as a tail consumer of '$TARGET'..."
wrangler tail-consumer add "$TARGET" "$CONSUMER"

echo
echo "✔ Done. '$TARGET' will now emit trace events to '$CONSUMER'."
echo "  → They will be forwarded to Loki with label app=$TARGET, source=cf-worker."
echo
echo "Alternative (for git-tracked, declarative setups), add to $TARGET's wrangler.toml:"
echo
cat <<EOF
[[tail_consumers]]
service = "$CONSUMER"
EOF
echo
echo "Then redeploy: wrangler deploy"
