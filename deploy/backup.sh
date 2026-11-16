#!/usr/bin/env bash
# =============================================================================
# Snout / CHORD — backup data + uploads + .env
#
#   sudo bash deploy/backup.sh
#
# Writes a timestamped tar.gz to /opt/snout/backups and keeps the newest
# BACKUP_RETENTION archives (default 14). Does not stop the service.
# When the sqlite3 CLI is available (setup-vps.sh installs it) the SQLite store
# is snapshotted with `.backup`, which is safe against concurrent WAL writes.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/snout/app}"
DATA_DIR="${SNOUT_DATA_DIR:-/opt/snout/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/snout/backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-14}"

log()  { printf '\033[1;34m[backup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[backup]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[backup]\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
fi

[[ -d "$DATA_DIR" ]] || die "Data directory ${DATA_DIR} does not exist."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/snout-${STAMP}.tar.gz"
STAGE="$(mktemp -d "${BACKUP_DIR}/.stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/data"

# ---------------------------------------------------------------------------
# SQLite: use the online backup API when possible, so WAL writers don't race.
# ---------------------------------------------------------------------------
SQLITE_SNAPSHOT=0
if [[ -f "$DATA_DIR/snout.db" && -x "$(command -v sqlite3 || true)" ]]; then
  log "Creating consistent SQLite snapshot..."
  if sqlite3 "$DATA_DIR/snout.db" ".backup '${STAGE}/data/snout.db'"; then
    SQLITE_SNAPSHOT=1
  else
    warn "sqlite3 .backup failed; falling back to a file copy."
    rm -f "$STAGE/data/snout.db"
  fi
fi

# ---------------------------------------------------------------------------
# Copy the data directory (uploads included). If we snapshotted SQLite, skip
# the live db/wal/shm files to avoid mixing a stale copy with the snapshot.
# ---------------------------------------------------------------------------
if [[ "$SQLITE_SNAPSHOT" -eq 1 ]]; then
  rsync -a \
    --exclude 'snout.db' --exclude 'snout.db-wal' --exclude 'snout.db-shm' \
    "$DATA_DIR/" "$STAGE/data/"
else
  if [[ -f "$DATA_DIR/snout.db" ]]; then
    warn "sqlite3 CLI unavailable or snapshot failed — the SQLite copy may be inconsistent."
    warn "Install sqlite3 (apt-get install -y sqlite3) and re-run for a safe snapshot."
  fi
  rsync -a "$DATA_DIR/" "$STAGE/data/"
fi

# .env is stored under a distinct member name so restore is unambiguous.
if [[ -f "$APP_DIR/.env" ]]; then
  cp -a "$APP_DIR/.env" "$STAGE/data/app.env"
fi

log "Creating ${OUT} ..."
tar -czf "$OUT" -C "$STAGE/data" .
chmod 600 "$OUT"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
log "Backup written: ${OUT} (${SIZE})"

# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------
log "Pruning backups older than the newest ${BACKUP_RETENTION} archives..."
# shellcheck disable=SC2012
ls -1t "${BACKUP_DIR}"/snout-*.tar.gz 2>/dev/null \
  | tail -n "+$((BACKUP_RETENTION + 1))" \
  | while IFS= read -r old; do
      [[ -n "$old" ]] || continue
      rm -f -- "$old"
      log "Removed ${old}"
    done

log "Done. Restore example:"
log "  systemctl stop snout"
log "  tar -xzf ${OUT} -C ${DATA_DIR}"
log "  mv ${DATA_DIR}/app.env ${APP_DIR}/.env && chown ${APP_USER:-snout}: ${APP_DIR}/.env && chmod 600 ${APP_DIR}/.env"
log "  systemctl start snout"
