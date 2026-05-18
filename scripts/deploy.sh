#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/wgr_logs}"
SSH_USER="${SSH_USER:-debian}"
SSH_HOST="${SSH_HOST:-<VPS_IP>}"
REMOTE_DIR="${REMOTE_DIR:-/home/${SSH_USER}/wgr-logs}"
BRANCH="${BRANCH:-main}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✖ $1${NC}"; exit 1; }

command -v git >/dev/null 2>&1 || fail "git not installed"
command -v ssh >/dev/null 2>&1 || fail "ssh not installed"

# ─── 1. Push branch ──────────────────────────────────────────────
step "1/4 Pushing branch $BRANCH..."
if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "Uncommitted changes detected — commit first."
fi
git push origin "$BRANCH" || fail "Push failed"

# ─── 2. Pull on server ───────────────────────────────────────────
step "2/4 Pulling latest on $SSH_HOST..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
    "cd $REMOTE_DIR && git pull origin $BRANCH" \
    || fail "git pull failed on remote"

# ─── 3. docker compose up ────────────────────────────────────────
step "3/4 Pulling images and recreating services..."
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" \
    "cd $REMOTE_DIR && docker compose pull && docker compose up -d --remove-orphans" \
    || fail "compose up failed"

# ─── 4. Healthchecks ─────────────────────────────────────────────
step "4/4 Waiting for healthchecks..."
sleep 8
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "cd $REMOTE_DIR && docker compose ps" || true

LOKI_OK=$(ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" \
    "curl -sf http://localhost:3100/ready 2>/dev/null || echo FAIL")
GRAFANA_OK=$(ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" \
    "curl -sf http://localhost:3000/api/health 2>/dev/null || echo FAIL")

if [[ "$LOKI_OK" == *"ready"* ]]; then
    echo -e "${GREEN}✔ Loki ready${NC}"
else
    warn "Loki not ready — check logs: docker compose logs loki"
fi

if echo "$GRAFANA_OK" | grep -q '"database":"ok"'; then
    echo -e "${GREEN}✔ Grafana healthy${NC}"
else
    warn "Grafana not healthy — check logs: docker compose logs grafana"
fi

echo -e "\n${GREEN}✔ Deploy complete!${NC}"
