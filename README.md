# CHORD — Real-Time Communication Platform

**CHORD** is a full-stack real-time communication platform inspired by Discord, built with original branding, modular frontend/backend architecture, Socket.IO real-time messaging, WebRTC voice/video/screen-sharing, granular role-based access control (RBAC), a third-party bot developer portal, a platform admin dashboard, and **CHORD NITRO** premium subscriptions (**$2.00 USD / month**) powered by **Platega** (`https://platega.io/`).

---

## Architecture Overview

```
chord/
├── src/                        # React 19 + TypeScript + Vite + Tailwind CSS + Zustand + Motion
│   ├── components/             # ServerRail, ChannelSidebar, ChatArea, VoiceStageView, MemberList, FriendsView, Modals
│   ├── pages/                  # AuthPage, NitroPage, DeveloperPortalPage, AdminDashboardPage
│   ├── hooks/                  # useWebRTC (RTCPeerConnection mesh, VAD, Push-to-Talk, Screen Share)
│   ├── stores/                 # Zustand workspace state store
│   ├── services/               # REST client (api.ts) & Socket.IO client (socket.ts)
│   └── lib/                    # Firebase client SDK & Firestore helpers
├── backend/
│   └── src/
│       ├── auth/               # Registration, scrypt hashing, JWT sessions, email verification, reset, TOTP 2FA
│       ├── users/              # User profiles, presence, Nitro customization guards
│       ├── friends/            # Friend requests, accept/decline, remove, block/unblock
│       ├── messages/           # DMs, Group DMs, channels, attachments (10MB/100MB), reactions, pins, link previews
│       ├── servers/            # Server CRUD, public discovery, invite codes
│       ├── channels/           # Categories, Text/Voice/Announcement/Forum channels, permission overrides
│       ├── roles/              # Role hierarchy, colors, bitflag permissions
│       ├── moderation/         # Kick, ban, unban, timeout, audit logs
│       ├── bots/               # Bot applications, token rotation, slash commands, OAuth2 install, channel webhooks
│       ├── payments/           # Platega checkout creation, status polling, verified webhook handler ($2.00 USD/mo)
│       ├── subscriptions/      # Nitro subscription status, renewal disclosure, cancellation
│       ├── notifications/      # Real-time notifications
│       ├── community/          # Community roadmap ideas & voting
│       ├── support/            # Support ticket centre (user-facing)
│       ├── admin/              # Platform telemetry, badges, support inbox, roadmap triage, user/server/payment oversight, Platega integration
│       └── websocket/          # Socket.IO messaging, typing, presence & WebRTC signaling gateway
├── shared/                     # Shared TypeScript interfaces, permission bitflags & NITRO_PLAN constants
├── database/                   # PostgreSQL Prisma schema (21 models) + initial SQL migration
├── infrastructure/             # Nginx reverse proxy & LiveKit SFU configuration
├── tests/                      # Automated Vitest API integration tests
├── firestore.rules             # Firebase Firestore security rules
├── server.ts                   # Unified HTTP + Socket.IO + Vite server entrypoint (port 3000)
├── Dockerfile                  # Production container image
└── docker-compose.yml          # PostgreSQL, Redis, MinIO S3, LiveKit SFU, App, Nginx
```

---

## CHORD NITRO & Platega Payment Integration

- **Official Price**: **$2.00 USD / month** (`NITRO_PLAN.priceUsd = 2`, `currency = "USD"`, `interval = "month"`).
- **Zero Fake Activations**: Nitro is **never** activated from frontend redirects. Only a verified server-side webhook (`POST /api/payments/platega/webhook`) authenticated with `X-MerchantId` and `X-Secret`, matching `amount >= 2.00` and `currency === "USD"` with status `CONFIRMED`, activates `isNitro: true` and extends the 30-day subscription period.
- **Idempotency & Chargebacks**: Duplicate `CONFIRMED` callbacks are safely ignored; `CHARGEBACKED` callbacks automatically revoke Nitro benefits.

### Configuring Platega (`https://platega.io/`)

1. Create a merchant project in your Platega Merchant Dashboard.
2. Copy your **Merchant ID** and **API Secret**.
3. Set the environment variables in `.env`:
   ```env
   PLATEGA_API_URL=https://app.platega.io
   PLATEGA_MERCHANT_ID=your-platega-merchant-id
   PLATEGA_SECRET=your-platega-secret
   PLATEGA_WEBHOOK_SECRET=your-platega-secret
   ```
4. In Platega Merchant Settings, configure your **Webhook Callback URL**:
   ```
   https://<your-domain>/api/payments/platega/webhook
   ```
5. Platega creates transactions via `POST https://app.platega.io/transaction/process` and verifies status via `GET https://app.platega.io/transaction/{id}`.

> **Local Webhook Testing**: You may optionally set `PLATEGA_SANDBOX_MODE=true` in local development only to test the internal webhook state machine. Never enable `PLATEGA_SANDBOX_MODE` in production.

---

## Community Features & Admin Console

- **Platform Badges** — admins create custom badges (label, emoji, colour, priority) and award them per member. Badges render on profiles, the member list, and admin tables.
- **Community Roadmap Votes** — members submit ideas and upvote; admins triage status (Under review → Planned → In progress → Shipped) and post public staff responses.
- **Support Centre** — members open tickets with category and priority, follow the thread, and receive real-time replies; staff manage the queue from the Admin Console.
- **Community Databases** — the built-in SQLite table explorer is managed from Admin Console → Community Databases (browse, edit cells, add rows/columns, create tables, delete, and CSV-export).
- **Documentation** — a searchable in-app docs centre covering servers, voice, databases, bots, Platega billing, and trust/safety.
- **Project icon** — `public/snout-icon.svg` is the official Snout mark, with generated PNG sizes and web manifest for PWA installs.

### Platega Integration from the Admin Console

Admin Console → Integrations → Platega lets operators paste the Merchant ID, API secret, webhook secret, and API base URL without redeploying. Overrides take priority over `.env`. The panel shows credential status, the generated webhook URL, a one-click connection test, and a Nitro price editor.

---

## Deploying to Vercel

The frontend builds as a static Vite bundle and every `/api/*` route is served by the
serverless function in `api/index.ts`. Set these environment variables in the Vercel
project settings before the first deploy:

- `JWT_SECRET` — a long random string (required; otherwise sessions break across cold starts).
- Public registration never grants platform-admin privileges; verified accounts are promoted with `npm run admin:promote -- <email>` from the server.
- `PLATEGA_MERCHANT_ID`, `PLATEGA_SECRET`, `PLATEGA_WEBHOOK_SECRET` — for live billing.
- `APP_URL` — your production domain (used for Platega return/webhook URLs).

Caveats: Vercel's filesystem is read-only except `/tmp`, and the serverless function
is stateless, so the SQLite store lives in `/tmp` per instance and is reset on cold
starts. For a persistent, real-time deployment (WebRTC voice, Socket.IO, durable
storage) run the unified `npm start` server on Render/Railway/Fly/Docker instead.

---

## Local Development Setup

### Prerequisites
- **Node.js 20+** and **npm 10+**

### Install & Run
```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env with JWT_SECRET, APP_URL, and Platega credentials

# 3. Start the unified Express + Socket.IO + Vite server on port 3000
npm run dev
```

Open `http://localhost:3000`.

### Scripts
- `npm run dev` — Run full-stack server with Vite middleware on port `3000`
- `npm run build` — Build production frontend bundle (`dist/`)
- `npm start` — Run production server (`NODE_ENV=production tsx server.ts`)
- `npm run lint` — TypeScript check (`tsc --noEmit`)
- `npm run lint:rules` — Validate `firestore.rules` with `@firebase/eslint-plugin-security-rules`
- `npm test` — Run Vitest API and security rules test suites

---

## Optional Infrastructure Stack (Docker Compose)

The current VPS runtime uses SQLite/local disk and peer-to-peer WebRTC mesh. The
Docker Compose Postgres/Redis/MinIO/LiveKit stack is scaffolding and is not wired
into the current API or browser call path.

1. Populate `.env` with production secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PLATEGA_MERCHANT_ID`, `PLATEGA_SECRET`, `S3_*`, `LIVEKIT_*`).
2. Start all infrastructure services:
   ```bash
   docker compose up -d --build
   ```
3. Run PostgreSQL schema migration using Prisma:
   ```bash
   npx prisma migrate deploy --schema=database/schema.prisma
   ```
4. Services exposed:
   - **Nginx Reverse Proxy**: Port `80` (routes `/`, `/api/*`, and `/socket.io/*` WebSocket upgrades to the CHORD Node server)
   - **PostgreSQL 16**: Port `5432`
   - **Redis 7**: Port `6379`
   - **MinIO (S3 Object Storage)**: Ports `9000` / `9001`
   - **LiveKit SFU**: Ports `7880` / `7881` / `50000-50100/udp`

---

## Security & Rules Verification

- Passwords hashed with Node `crypto.scryptSync` + per-user random salt and verified with `crypto.timingSafeEqual`.
- RFC 6238 TOTP Two-Factor Authentication supported on login and account settings.
- Server-side permission enforcement on every server, channel, role, moderation, and file upload route (10 MB free / 100 MB Nitro).
- Firestore Security Rules (`firestore.rules`) enforce default-deny, field whitelists, owner isolation for `/users/{userId}/private/*`, and read-only client access for `/subscriptions/*` and `/payments/*`.
