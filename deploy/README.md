# Deploying Snout / CHORD on a VPS

Target: **Ubuntu 22.04 / 24.04**, app VPS **95.111.216.126**, public domain **snout.cloud**.
The requested first voice host is **16.16.120.220**. Calls use its TURN relay directly; an optional `voice.snout.cloud` A record can point there.
Stack: Node.js 22 + `tsx` (unified Express + Socket.IO server on port 3000),
nginx on 80/443, systemd service `snout`, SQLite/JSON store + uploads on disk.

Everything here is idempotent — re-running a script is safe.

---

## 1. One-command bootstrap (from your workstation)

If the repository is already pushed to GitHub:

```bash
ssh root@95.111.216.126 'apt-get update -qq && apt-get install -y git && mkdir -p /opt/snout && git clone https://github.com/FurBro-ai/98ut9tert /opt/snout/app && bash /opt/snout/app/deploy/setup-vps.sh'
```

Or upload your local working tree first, then bootstrap:

```bash
rsync -avz --progress \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude data --exclude uploads --exclude '.env' \
  ./ root@95.111.216.126:/opt/snout/app/ \
&& ssh root@95.111.216.126 'bash /opt/snout/app/deploy/setup-vps.sh'
```

What the script does:

1. Installs `curl git build-essential nginx ufw rsync` (+ `python3`, `openssl`, `gnupg`).
2. Installs **Node.js 22 LTS** from NodeSource if Node is missing or < 20.
3. Creates the `snout` system user (home `/opt/snout`) and `/opt/snout/app`.
4. Runs `npm ci` (falls back to `npm install`), including dev deps (`tsx`, `vite`).
5. Creates `/opt/snout/data` and symlinks `/opt/snout/app/uploads` →
   `/opt/snout/data/uploads` so uploads survive redeploys.
6. Creates `.env` from `.env.production.example` **only if missing**, `chmod 600`,
   and auto-generates `JWT_SECRET` (`openssl rand -hex 48`) while the placeholder remains.
7. Runs `npm run build` (Vite → `dist/`).
8. Installs/enables/restarts the `snout` systemd unit.
9. Installs the nginx site, disables the stock `default` site, tests and reloads nginx.
10. Adds UFW rules for OpenSSH, 80/tcp, 443/tcp (existing rules untouched) and enables UFW.
11. Waits for `http://127.0.0.1:3000/api/health` and prints next steps.

If `/opt/snout/app` has no `package.json`, the script prepares the system, prints the
exact `rsync`/`REPO_URL` commands, and exits successfully.

---

## 2. Configure the environment

```bash
ssh root@95.111.216.126
nano /opt/snout/app/.env
```

At minimum set:

```env
APP_URL="https://snout.cloud"
ADMIN_ALLOWED_IPS="37.136.39.31"
PLATEGA_MERCHANT_ID=""
PLATEGA_SECRET=""
PLATEGA_WEBHOOK_SECRET=""
```

Already handled automatically:

- `JWT_SECRET` — generated if still `CHANGE_ME...`.
- `SNOUT_DATA_DIR=/opt/snout/data` — persistent store.
- `PORT=3000` — nginx proxies to this; **do not expose 3000 publicly**.
- `ADMIN_ALLOWED_IPS` — limits platform-admin APIs to the listed client addresses. Password and 2FA are still required.

Apply changes:

```bash
systemctl restart snout
```

Public sign-up never grants administrator privileges. To promote an already
verified account, stop the app first so its in-memory state cannot overwrite the
operator change, then start it again:

```bash
sudo systemctl stop snout
sudo -u snout env SNOUT_DATA_DIR=/opt/snout/data \
  npm --prefix /opt/snout/app run admin:promote -- operator@example.com
sudo systemctl start snout
```

Choose a fresh password of at least 16 characters, since a password previously
posted in chat should be considered compromised. Existing unverified accounts
are refused; verify their ownership before provisioning.

> Uploads use `UPLOADS_DIR`; setup also keeps `/opt/snout/app/uploads` linked to the
> persistent `/opt/snout/data/uploads` directory for compatibility with existing deployments.

---

## 3. Verify

```bash
systemctl status snout
journalctl -u snout -f
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://snout.cloud/api/health
```

Open `https://snout.cloud/` in a browser.

---

## 4. TLS / domain (optional but recommended)

Point DNS `A` records for `snout.cloud` and `www.snout.cloud` to `95.111.216.126`.
Point `voice.snout.cloud` to the separate voice host `16.16.120.220` if you want a named endpoint. Let's Encrypt
does **not** issue certificates for bare IP addresses. The current TURN URLs use the IP directly and do not require that record.
Once DNS for the app domain has propagated:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d snout.cloud -d www.snout.cloud
```

Then update `.env`:

```env
APP_URL="https://snout.cloud"
```

and `systemctl restart snout`. Certbot rewrites the nginx site and adds an HTTP→HTTPS
redirect. Renewal is automatic via the `certbot.timer`; check with
`systemctl list-timers | grep certbot`.

If you use a domain before TLS, add it to `SERVER_NAME` when running setup:

```bash
SERVER_NAME="snout.cloud www.snout.cloud" HOST_IP="95.111.216.126" bash deploy/setup-vps.sh
```

---

## 5. Ports

| Port | Protocol | Purpose | Expose publicly? |
| --- | --- | --- | --- |
| 22 | TCP | SSH | yes (restrict to your IPs if possible) |
| 80 | TCP | HTTP (nginx, ACME) | yes |
| 443 | TCP | HTTPS (nginx) | yes |
| 3000 | TCP | Node app behind nginx | **no** — localhost only |
| 3478 | TCP + UDP | coturn TURN relay on 16.16.120.220 | yes |
| 49152–65535 | UDP | coturn relay range on 16.16.120.220 | yes |

UFW is configured by setup. Check with `ufw status verbose`; add your own rules with
`ufw allow <port>` (setup never removes existing rules).

---

## 6. Day-to-day operations

```bash
# Deploy an update (pull → npm ci → build → restart → health check)
sudo bash /opt/snout/app/deploy/deploy.sh

# Service control
sudo systemctl restart snout
sudo systemctl status snout
journalctl -u snout -f
journalctl -u snout -n 200 --no-pager

# nginx
sudo nginx -t
sudo systemctl reload nginx
tail -f /var/log/nginx/snout.error.log /var/log/nginx/snout.access.log
```

`deploy.sh` aborts if `git pull --ff-only` fails, and prints the last 100 journal
lines if the health check does not pass.

---

## 7. Backups

```bash
sudo bash /opt/snout/app/deploy/backup.sh
```

Creates `/opt/snout/backups/snout-YYYYmmdd-HHMMSS.tar.gz` containing the whole data
directory (SQLite/JSON store + uploads) and `.env` (stored as `app.env`), mode `600`.
Keeps the newest 14 archives; override with `BACKUP_RETENTION=30`.

Suggested cron (daily at 03:17):

```cron
17 3 * * * root /bin/bash /opt/snout/app/deploy/backup.sh >> /var/log/snout-backup.log 2>&1
```

Copy backups off the VPS regularly (`rsync`/`scp` to another host). A backup on the
same disk is not a real backup.

Restore:

```bash
sudo systemctl stop snout
sudo tar -xzf /opt/snout/backups/snout-YYYYmmdd-HHMMSS.tar.gz -C /opt/snout/data
# restore env: extract app.env from the archive and copy to /opt/snout/app/.env
sudo systemctl start snout
```

---

## 8. WebRTC / voice & video caveats

The app uses a **peer-to-peer WebRTC mesh** with public STUN and a coturn relay
at `16.16.120.220`. The API issues 30-minute HMAC TURN credentials to signed-in
users; the shared secret is stored only in the app and relay configuration.
The current browser call path does not use the optional LiveKit container.

- Users on permissive NAT may connect directly; restrictive NATs can relay media
  through coturn when the cloud firewall allows the configured ports.
- The host UFW permits TCP/UDP 3478 and UDP 49152–65535. The AWS security group
  for `16.16.120.220` must also allow TCP/UDP 3478 and UDP 49152–65535. TCP 3478
  from the app host currently times out, indicating the cloud ingress rule is not
  open yet; there is no attached AWS role available to update it automatically.
- The nginx WebSocket proxy **is** configured (`/socket.io/` with upgrade headers),
  which is required for Socket.IO signalling.

### Relay maintenance

```bash
sudo systemctl status coturn
sudo journalctl -u coturn -n 100 --no-pager
sudo ufw status numbered
```

The app fetches short-lived ICE credentials from `/api/voice/ice-config` when a
call starts, with STUN-only fallback if the relay is unreachable. The browser
also needs camera/microphone permission; nginx allows those features for this origin.

> The nginx config only proxies HTTP/WebSocket. WebRTC media does **not** go through
> nginx; it flows directly (or via TURN) on UDP.

---

## 9. Caveats about the current app

- **State is local SQLite/JSON on this VPS.** There is no Postgres/Redis in this
  deployment path even though `docker-compose.yml` references them. Back up
  `/opt/snout/data` or data will be lost if the disk dies.
- **`tsx` runs TypeScript at runtime.** Dev dependencies must be installed
  (`npm ci --include=dev`, which the scripts do). `npm ci --omit=dev` will break
  `npm start`.
- **Port 3000 is loopback-only** on the VPS deployment; nginx is the only public entry point.
- **`UPLOADS_DIR` is not honoured yet.** Uploads live in `/opt/snout/app/uploads`,
  symlinked to `/opt/snout/data/uploads`.
- **No TLS for the bare IP.** Use a domain + certbot for HTTPS; set `APP_URL` to the
  `https://` URL afterwards or Platega return URLs will be wrong.
- **Platega webhooks** must be configured in the Platega dashboard as
  `${APP_URL}/api/payments/platega/webhook`. Without merchant credentials, checkout
  is disabled but the rest of the app works.
- **Build memory:** `vite build` on a 512 MB VPS can be OOM-killed. Add swap
  (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`)
  if the build fails with signal 137.
- **Single-node realtime.** Socket.IO presence/voice state is in-process; a restart
  drops live connections (clients reconnect automatically).

---

## 10. Files in this directory

| File | Purpose |
| --- | --- |
| `setup-vps.sh` | Full idempotent bootstrap (packages, Node, user, deps, build, systemd, nginx, UFW). |
| `deploy.sh` | Update deploy: git pull → npm ci → build → restart → health check. |
| `backup.sh` | Timestamped tar.gz of data + uploads + `.env`, with retention. |
| `snout.service` | Hardened systemd unit (`User=snout`, `ProtectSystem=strict`, writable data/uploads). |
| `nginx-snout.conf` | Reverse proxy for `/`, `/api/`, `/uploads/`, `/socket.io/`; gzip + security headers. |
| `../.env.production.example` | Production env template (only variables the backend actually reads). |
