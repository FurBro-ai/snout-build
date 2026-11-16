#!/usr/bin/env bash
# =============================================================================
# Snout / CHORD — quick update / redeploy
#
#   sudo bash deploy/deploy.sh
#
# Pulls the latest code (if this is a git checkout), reinstalls dependencies,
# rebuilds the frontend, restarts the service and waits for /api/health.
# Idempotent and safe to run repeatedly.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/snout/app}"
APP_USER="${APP_USER:-snout}"
APP_HOME="${APP_HOME:-/opt/snout}"
SERVICE="${SERVICE:-snout}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log "Not running as root; re-executing with sudo..."
  exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
fi

[[ -f "$APP_DIR/package.json" ]] || die "No package.json in ${APP_DIR}. Run deploy/setup-vps.sh first."

run_as_app() {
  runuser -u "$APP_USER" -- env \
    HOME="$APP_HOME" \
    npm_config_cache="$APP_HOME/.npm" \
    "$@"
}

cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 1. Pull latest code (only for git checkouts)
# ---------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Pulling latest code..."
  run_as_app git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
  if ! run_as_app git -C "$APP_DIR" pull --ff-only; then
    die "git pull --ff-only failed (local changes or diverged branch). Resolve manually, then re-run."
  fi
else
  warn "Not a git checkout — deploying the files currently in ${APP_DIR}."
fi

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
log "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  if ! run_as_app npm ci --include=dev --no-audit --no-fund; then
    warn "npm ci failed; falling back to npm install."
    run_as_app npm install --include=dev --no-audit --no-fund
  fi
else
  run_as_app npm install --include=dev --no-audit --no-fund
fi

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------
log "Building frontend bundle..."
run_as_app npm run build

# ---------------------------------------------------------------------------
# 4. Restart
# ---------------------------------------------------------------------------
log "Restarting ${SERVICE}..."
systemctl restart "$SERVICE"

# ---------------------------------------------------------------------------
# 5. Health check
# ---------------------------------------------------------------------------
log "Waiting for ${HEALTH_URL} ..."
HEALTH_BODY=""
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if HEALTH_BODY="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
    log "Health check passed after ${i} attempt(s):"
    printf '  %s\n' "$HEALTH_BODY"
    break
  fi
  if [[ "$i" -eq "$HEALTH_RETRIES" ]]; then
    warn "Health check failed after ${HEALTH_RETRIES} attempts."
    warn "Last 100 log lines:"
    journalctl -u "$SERVICE" -n 100 --no-pager || true
    die "Deploy finished but the service is unhealthy."
  fi
  sleep "$HEALTH_DELAY"
done

# ---------------------------------------------------------------------------
# 6. Status
# ---------------------------------------------------------------------------
log "Service status:"
systemctl --no-pager --lines=0 status "$SERVICE" || true
log "Deployed commit: $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'n/a (not a git checkout)')"
log "Done."
