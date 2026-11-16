#!/usr/bin/env bash
# =============================================================================
# Snout / CHORD — one-shot VPS bootstrap for Ubuntu 22.04 / 24.04
#
#   sudo bash deploy/setup-vps.sh
#
# Idempotent: safe to re-run after pulling new code or changing env.
# Optional environment variables:
#   APP_DIR       application directory        (default /opt/snout/app)
#   SNOUT_DATA_DIR persistent data directory   (default /opt/snout/data)
#   APP_USER      system user                  (default snout)
#   REPO_URL      git URL to clone if APP_DIR has no package.json
#   SERVER_NAME   nginx server_name value      (default "snout.cloud www.snout.cloud")
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/snout/app}"
APP_USER="${APP_USER:-snout}"
APP_GROUP="${APP_GROUP:-snout}"
APP_HOME="${APP_HOME:-/opt/snout}"
DATA_DIR="${SNOUT_DATA_DIR:-/opt/snout/data}"
SERVICE="${SERVICE:-snout}"
REPO_URL="${REPO_URL:-}"
SERVER_NAME="${SERVER_NAME:-snout.cloud www.snout.cloud}"
HOST_IP="${HOST_IP:-95.111.216.126}"

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${DEPLOY_DIR}/.." && pwd)"

log()  { printf '\033[1;34m[snout]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[snout]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[snout]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Root check — re-exec through sudo if needed
# ---------------------------------------------------------------------------
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log "Not running as root; re-executing with sudo..."
  exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  log "Detected ${PRETTY_NAME:-unknown OS} (script targets Ubuntu 22.04/24.04)."
fi

run_as_app() {
  runuser -u "$APP_USER" -- env \
    HOME="$APP_HOME" \
    npm_config_cache="$APP_HOME/.npm" \
    "$@"
}

# ---------------------------------------------------------------------------
# 1. Base packages
# ---------------------------------------------------------------------------
log "Installing base packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg git build-essential python3 \
  nginx ufw rsync openssl sqlite3

# ---------------------------------------------------------------------------
# 2. Node.js 22 LTS (NodeSource) if node is missing or too old
# ---------------------------------------------------------------------------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
fi

if [[ "$NODE_MAJOR" -lt 20 ]]; then
  log "Installing Node.js 22 LTS from NodeSource (found major: ${NODE_MAJOR})..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  cat >/etc/apt/sources.list.d/nodesource.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main
EOF
  apt-get update -y
  apt-get install -y nodejs
else
  log "Node.js $(node --version) already installed; leaving it alone."
fi
command -v npm >/dev/null 2>&1 || die "npm not found after Node.js installation."
log "Using node $(node --version) / npm $(npm --version)."

# ---------------------------------------------------------------------------
# 3. System user + directories
# ---------------------------------------------------------------------------
log "Ensuring system user '${APP_USER}' and directories..."
if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  groupadd --system "$APP_GROUP"
fi
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --create-home \
    --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
  log "Created user ${APP_USER}."
else
  log "User ${APP_USER} already exists."
fi

mkdir -p "$APP_HOME" "$APP_DIR" "$DATA_DIR/uploads" "$APP_HOME/.npm"
chown -R "$APP_USER:$APP_GROUP" "$APP_HOME"

# ---------------------------------------------------------------------------
# 4. Application code (clone if requested, otherwise explain how to upload)
# ---------------------------------------------------------------------------
if [[ ! -f "$APP_DIR/package.json" && -n "$REPO_URL" ]]; then
  if [[ -z "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]]; then
    log "Cloning ${REPO_URL} into ${APP_DIR}..."
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
    run_as_app git clone "$REPO_URL" "$APP_DIR"
  else
    warn "APP_DIR is not empty and has no package.json; refusing to clone over it."
  fi
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  cat <<EOF

================================================================================
  Application code is not in ${APP_DIR} yet.
================================================================================
Upload it from your workstation (run this locally, not on the VPS):

  rsync -avz --progress \\
    --exclude node_modules --exclude .git --exclude dist \\
    --exclude data --exclude uploads --exclude '.env' \\
    ./ root@${HOST_IP}:${APP_DIR}/

...or clone directly on the VPS and re-run:

  REPO_URL=https://github.com/FurBro-ai/98ut9tert \\
    APP_DIR=${APP_DIR} bash ${APP_DIR}/deploy/setup-vps.sh

Then re-run:

  bash ${APP_DIR}/deploy/setup-vps.sh

Base packages, the ${APP_USER} user, and ${DATA_DIR} are already prepared.
================================================================================

EOF
  exit 0
fi

log "Found application at ${APP_DIR}."
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

# ---------------------------------------------------------------------------
# 5. Dependencies
# ---------------------------------------------------------------------------
cd "$APP_DIR"
run_as_app git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true

log "Installing npm dependencies..."
if [[ -f package-lock.json ]]; then
  if ! run_as_app npm ci --include=dev --no-audit --no-fund; then
    warn "npm ci failed; falling back to npm install."
    run_as_app npm install --include=dev --no-audit --no-fund
  fi
else
  run_as_app npm install --include=dev --no-audit --no-fund
fi

# ---------------------------------------------------------------------------
# 6. Persistent data + uploads
#    The backend writes uploads to <APP_DIR>/uploads (hard-coded), so symlink
#    that path into the persistent data dir to survive deploys.
# ---------------------------------------------------------------------------
log "Preparing persistent data directories..."
mkdir -p "$DATA_DIR/uploads"
UPLOADS_LINK="$APP_DIR/uploads"
if [[ -L "$UPLOADS_LINK" ]]; then
  if [[ "$(readlink -f "$UPLOADS_LINK")" != "$(readlink -f "$DATA_DIR/uploads")" ]]; then
    rm -f "$UPLOADS_LINK"
    ln -s "$DATA_DIR/uploads" "$UPLOADS_LINK"
  fi
elif [[ -d "$UPLOADS_LINK" ]]; then
  rsync -a "$UPLOADS_LINK/" "$DATA_DIR/uploads/"
  mv "$UPLOADS_LINK" "${UPLOADS_LINK}.legacy.$(date +%Y%m%d%H%M%S)"
  ln -s "$DATA_DIR/uploads" "$UPLOADS_LINK"
else
  ln -s "$DATA_DIR/uploads" "$UPLOADS_LINK"
fi
chown -R "$APP_USER:$APP_GROUP" "$DATA_DIR"
chown -h "$APP_USER:$APP_GROUP" "$UPLOADS_LINK"

# ---------------------------------------------------------------------------
# 7. .env
# ---------------------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  TEMPLATE=""
  for candidate in \
    "$APP_DIR/.env.production.example" \
    "$REPO_ROOT/.env.production.example" \
    "$DEPLOY_DIR/../.env.production.example"; do
    if [[ -f "$candidate" ]]; then TEMPLATE="$candidate"; break; fi
  done
  if [[ -n "$TEMPLATE" ]]; then
    cp "$TEMPLATE" "$ENV_FILE"
    log "Created ${ENV_FILE} from ${TEMPLATE}."
  else
    warn "No .env.production.example found; creating a minimal .env."
    cat >"$ENV_FILE" <<EOF
APP_URL="https://snout.cloud"
PORT=3000
NODE_ENV=production
JWT_SECRET="CHANGE_ME_STRONG_RANDOM_64_CHAR_SECRET"
SNOUT_DATA_DIR="${DATA_DIR}"
UPLOADS_DIR="${DATA_DIR}/uploads"
EOF
  fi
fi
chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

if grep -q '^JWT_SECRET=.*CHANGE_ME' "$ENV_FILE"; then
  JWT_SECRET_GENERATED="$(openssl rand -hex 48)"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"${JWT_SECRET_GENERATED}\"|" "$ENV_FILE"
  log "Generated a strong JWT_SECRET in ${ENV_FILE}."
elif ! grep -q '^JWT_SECRET=' "$ENV_FILE"; then
  printf 'JWT_SECRET="%s"\n' "$(openssl rand -hex 48)" >>"$ENV_FILE"
  log "Appended a generated JWT_SECRET to ${ENV_FILE}."
else
  log "JWT_SECRET already set; leaving it untouched."
fi

if ! grep -q '^SNOUT_DATA_DIR=' "$ENV_FILE"; then
  printf 'SNOUT_DATA_DIR="%s"\n' "$DATA_DIR" >>"$ENV_FILE"
elif [[ "$DATA_DIR" != "/opt/snout/data" ]]; then
  sed -i "s|^SNOUT_DATA_DIR=.*|SNOUT_DATA_DIR=\"${DATA_DIR}\"|" "$ENV_FILE"
fi

# sed -i rewrites the file as root; restore ownership before the service reads it.
chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------------------
# 8. Build frontend bundle
# ---------------------------------------------------------------------------
log "Building the application (npm run build)..."
run_as_app npm run build

# ---------------------------------------------------------------------------
# 9. systemd service
# ---------------------------------------------------------------------------
log "Installing systemd unit ${SERVICE}.service..."
install -m 0644 "$DEPLOY_DIR/snout.service" "/etc/systemd/system/${SERVICE}.service"
UNIT="/etc/systemd/system/${SERVICE}.service"
# Substitute paths/user only when they differ from the shipped defaults.
if [[ "$APP_DIR" != "/opt/snout/app" ]]; then
  sed -i "s|/opt/snout/app|${APP_DIR}|g" "$UNIT"
fi
if [[ "$DATA_DIR" != "/opt/snout/data" ]]; then
  sed -i "s|/opt/snout/data|${DATA_DIR}|g" "$UNIT"
fi
if [[ "$APP_HOME" != "/opt/snout" ]]; then
  sed -i \
    -e "s|^Environment=HOME=.*|Environment=HOME=${APP_HOME}|" \
    -e "s|^Environment=npm_config_cache=.*|Environment=npm_config_cache=${APP_HOME}/.npm|" \
    -e "s|/opt/snout/\.npm|${APP_HOME}/.npm|g" \
    "$UNIT"
fi
if [[ "$APP_USER" != "snout" ]]; then
  sed -i "s|^User=snout$|User=${APP_USER}|; s|^Group=snout$|Group=${APP_GROUP}|" "$UNIT"
fi

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

# ---------------------------------------------------------------------------
# 10. nginx
# ---------------------------------------------------------------------------
log "Installing nginx site..."
NGINX_SITE="/etc/nginx/sites-available/snout.conf"
install -m 0644 "$DEPLOY_DIR/cloudflare-real-ip.conf" /etc/nginx/conf.d/cloudflare-real-ip.conf
install -m 0644 "$DEPLOY_DIR/nginx-snout.conf" "$NGINX_SITE"
sed -i "s|^    server_name .*;|    server_name ${SERVER_NAME};|" "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/snout.conf

# The stock Ubuntu site also declares default_server and would conflict.
if [[ -e /etc/nginx/sites-enabled/default ]] \
   && grep -q 'default_server' /etc/nginx/sites-enabled/default 2>/dev/null; then
  rm -f /etc/nginx/sites-enabled/default
  log "Disabled stock /etc/nginx/sites-enabled/default (kept in sites-available)."
fi

if ! nginx -t; then
  die "nginx configuration test failed — fix the error above and re-run."
fi
systemctl enable nginx
systemctl reload nginx 2>/dev/null || systemctl restart nginx

# ---------------------------------------------------------------------------
# 11. Firewall (additive; existing rules preserved)
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  log "Configuring UFW (additive)..."
  SSH_PORT="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }' || true)"
  SSH_PORT="${SSH_PORT:-22}"
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow "${SSH_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null
  ufw status verbose || true
else
  warn "ufw not found; opening ports is up to you."
fi

# ---------------------------------------------------------------------------
# 12. Health check (best effort)
# ---------------------------------------------------------------------------
HEALTH_OK=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" -eq 1 ]]; then
  log "Health check passed: http://127.0.0.1:3000/api/health"
else
  warn "Service is not answering /api/health yet. Inspect logs with:"
  warn "  journalctl -u ${SERVICE} -n 100 --no-pager"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

================================================================================
  Snout / CHORD bootstrap complete
================================================================================
  URL:            https://snout.cloud/       (after DNS and TLS are configured)
  Direct app:     http://127.0.0.1:3000/      (internal only)
  App directory:  ${APP_DIR}
  Data/uploads:   ${DATA_DIR}  (${APP_DIR}/uploads is a symlink into it)
  Env file:       ${ENV_FILE}  (chmod 600)
  Service:        systemctl status ${SERVICE}
  Logs:           journalctl -u ${SERVICE} -f
  Health:         curl -fsS http://127.0.0.1:3000/api/health

  NEXT STEPS
  1. Edit ${ENV_FILE}:
      - APP_URL (use https://snout.cloud after TLS is live)
      - PLATEGA_MERCHANT_ID / PLATEGA_SECRET / PLATEGA_WEBHOOK_SECRET
     then: sudo systemctl restart ${SERVICE}
  2. (Optional) TLS. Let's Encrypt needs a DNS name, not a bare IP:
       sudo apt-get install -y certbot python3-certbot-nginx
      sudo certbot --nginx -d snout.cloud -d www.snout.cloud
      # then set APP_URL=https://snout.cloud and restart
  3. (Optional) WebRTC behind strict NAT: install coturn (see deploy/README.md).
  4. Future updates: sudo bash ${APP_DIR}/deploy/deploy.sh
  5. Backups: sudo bash ${APP_DIR}/deploy/backup.sh
================================================================================

EOF
