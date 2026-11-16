#!/usr/bin/env bash
# =============================================================================
# Publish desktop builds to the main Snout server (nginx serves /downloads/).
#
#   bash deploy/publish-downloads.sh \
#     --host root@95.111.216.126 \
#     --version 1.0.0 \
#     Snout-macOS-universal.dmg Snout-Windows-x64-setup.exe
#
# Writes /opt/snout/downloads/latest.json with sizes + SHA-256 checksums.
# =============================================================================
set -euo pipefail

HOST="root@95.111.216.126"
VERSION="1.0.0"
REMOTE_DIR="/opt/snout/downloads"
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

[[ ${#FILES[@]} -gt 0 ]] || { echo "Pass at least one build file" >&2; exit 1; }
for f in "${FILES[@]}"; do [[ -f "$f" ]] || { echo "Missing file: $f" >&2; exit 1; }; done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sha256sum "${FILES[@]}" > "$TMP/SHA256SUMS.txt"
mkdir -p "$TMP/upload"
for f in "${FILES[@]}"; do cp "$f" "$TMP/upload/$(basename "$f")"; done
cp "$TMP/SHA256SUMS.txt" "$TMP/upload/SHA256SUMS.txt"

mac_file=""; win_file=""; linux_file=""
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  shopt -s nocasematch
  case "$base" in
    *.dmg) mac_file="$base" ;;
    *.exe) win_file="$base" ;;
    *.appimage) linux_file="$base" ;;
  esac
  shopt -u nocasematch
done

json_file() {
  local name="$1"
  [[ -n "$name" ]] || { printf 'null'; return; }
  local path="$TMP/upload/$name"
  local size sha
  size=$(stat -c %s "$path")
  sha=$(sha256sum "$path" | awk '{print $1}')
  printf '{"file":"%s","size":%s,"sha256":"%s"}' "$name" "$size" "$sha"
}

cat > "$TMP/upload/latest.json" <<JSON
{
  "version": "${VERSION}",
  "channel": "stable",
  "publishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "mac": $(json_file "$mac_file"),
    "win": $(json_file "$win_file"),
    "linux": $(json_file "$linux_file"),
    "checksums": {"file":"SHA256SUMS.txt","size":$(stat -c %s "$TMP/SHA256SUMS.txt")}
  },
  "notes": [
    "Auto voice relay selection with client-side TURN latency probes.",
    "Global voice fleet management from the admin console.",
    "Community database builder with CSV import/export."
  ]
}
JSON

ssh "$HOST" "install -d -m 755 -o snout -g snout '$REMOTE_DIR'"
scp -q "$TMP/upload/"* "$HOST:$REMOTE_DIR/"
ssh "$HOST" "chown -R snout:snout '$REMOTE_DIR' && chmod 644 '$REMOTE_DIR'/*"
echo "Published ${#FILES[@]} file(s) to https://snout.cloud/downloads/"
ls -lh "$TMP/upload"
