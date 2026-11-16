#!/usr/bin/env bash
# =============================================================================
# Snout — provision this host as a TURN voice relay node
#
#   bash deploy/setup-voice-node.sh --ip 95.111.216.126 --secret <hex>
#   bash deploy/setup-voice-node.sh --ip 16.16.120.220 --secret <hex>
#
# Installs coturn, writes a hardened /etc/turnserver.conf, opens the required
# firewall ports and restarts the service. Idempotent.
# =============================================================================
set -euo pipefail

PUBLIC_IP=""
SECRET=""
REALM="voice.snout.cloud"
MIN_PORT="49152"
MAX_PORT="65535"
LISTEN_PORT="3478"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) PUBLIC_IP="$2"; shift 2 ;;
    --secret) SECRET="$2"; shift 2 ;;
    --realm) REALM="$2"; shift 2 ;;
    --listen-port) LISTEN_PORT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -n "$PUBLIC_IP" ]] || { echo "--ip is required" >&2; exit 1; }
[[ -n "$SECRET" ]] || { echo "--secret is required" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
command -v turnserver >/dev/null 2>&1 || {
  apt-get update -qq
  apt-get install -y coturn
}

# The Debian package ships coturn disabled until this flag is set.
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn

cat > /etc/turnserver.conf <<CONF
# Managed by Snout deploy/setup-voice-node.sh
listening-port=${LISTEN_PORT}
fingerprint
use-auth-secret
static-auth-secret=${SECRET}
realm=${REALM}
server-name=${REALM}
external-ip=${PUBLIC_IP}
min-port=${MIN_PORT}
max-port=${MAX_PORT}
no-cli
no-loopback-peers
no-multicast-peers
no-tls
no-dtls
stale-nonce=600
total-quota=0
bps-capacity=0
CONF
chmod 600 /etc/turnserver.conf

systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn

if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then
  ufw allow ${LISTEN_PORT}/tcp >/dev/null
  ufw allow ${LISTEN_PORT}/udp >/dev/null
  ufw allow ${MIN_PORT}:${MAX_PORT}/udp >/dev/null
fi

echo "coturn relay ready on ${PUBLIC_IP}:${LISTEN_PORT} (realm ${REALM})"
systemctl --no-pager --lines=0 status coturn | head -5
