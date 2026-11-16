import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  Code2,
  Database,
  ExternalLink,
  LifeBuoy,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useChordStore } from '../stores/useChordStore.ts';

interface DocSection {
  id: string;
  title: string;
  summary: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: DocSection[] = [
  { id: 'start', title: 'Getting started', summary: 'Accounts, sessions, and the workspace layout.', keywords: 'signup login session token workspace rail', icon: Rocket },
  { id: 'servers', title: 'Servers & channels', summary: 'Create communities, categories, text, voice, and forum channels.', keywords: 'server channel category invite role permissions', icon: BookOpen },
  { id: 'voice', title: 'Voice, video & screen share', summary: 'WebRTC mesh audio, camera, push-to-talk, and screen sharing.', keywords: 'voice webrtc mic camera screen share deafen', icon: Sparkles },
  { id: 'databases', title: 'Community databases', summary: 'Structured SQLite tables and the admin database explorer.', keywords: 'database sqlite table rows columns admin roadmap', icon: Database },
  { id: 'bots', title: 'Bots & developer API', summary: 'Bot applications, tokens, slash commands, and webhooks.', keywords: 'bot token slash command webhook oauth api developer', icon: Bot },
  { id: 'billing', title: 'NITRO & Platega billing', summary: 'Monthly Nitro, checkout, webhooks, and reconciliation.', keywords: 'nitro platega payment billing subscription webhook price', icon: Wallet },
  { id: 'trust', title: 'Trust, safety & moderation', summary: 'RBAC, audit logs, 2FA, suspensions, and support escalation.', keywords: 'moderation ban kick timeout audit 2fa safety support', icon: ShieldCheck },
];

const API_EXAMPLES: Array<{ method: string; path: string; description: string }> = [
  { method: 'GET', path: '/api/health', description: 'Liveness probe for the API and SQLite WAL engine.' },
  { method: 'GET', path: '/api/servers', description: 'Servers the authenticated user belongs to.' },
  { method: 'GET', path: '/api/servers/:serverId/databases', description: 'Tables and rows for a server’s community database.' },
  { method: 'GET', path: '/api/community/ideas', description: 'Community roadmap ideas with vote counts.' },
  { method: 'POST', path: '/api/community/ideas/:ideaId/vote', description: 'Toggle an upvote on a roadmap idea.' },
  { method: 'GET', path: '/api/support/tickets', description: 'The current user’s support tickets.' },
  { method: 'POST', path: '/api/support/tickets', description: 'Open a new support ticket.' },
  { method: 'POST', path: '/api/bots/gateway/channels/:channelId/messages', description: 'Bot gateway message send (Authorization: Bot <token>).' },
  { method: 'POST', path: '/api/payments/platega/webhook', description: 'Verified Platega callback; never call this from a browser.' },
];

export const DocsPage: React.FC = () => {
  const { setActiveSection } = useChordStore();
  const [active, setActive] = useState('start');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.keywords.includes(q)
    );
  }, [search]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0F12] text-[#F1F3F5] p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-white/[0.06] pb-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
            <BookOpen className="h-4 w-4" /> Snout documentation
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-white">Platform & developer docs</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Everything you need to run a community, connect Platega, publish a bot, or operate the admin console.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="space-y-3 lg:col-span-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search docs…"
                className="w-full rounded-lg border border-white/10 bg-[#12151A] py-2 pl-9 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
            </div>
            <nav className="space-y-1" aria-label="Documentation sections">
              {filtered.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActive(section.id)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      active === section.id
                        ? 'bg-[#5865F2]/15 text-white ring-1 ring-[#5865F2]/40'
                        : 'text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active === section.id ? 'text-indigo-300' : 'text-slate-500'}`} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{section.title}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{section.summary}</span>
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">No sections match that search.</p>}
            </nav>

            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4 space-y-2">
              <div className="text-xs font-semibold text-white">Need a human?</div>
              <p className="text-[11px] text-slate-400">Open a ticket and a platform admin will reply.</p>
              <button
                type="button"
                onClick={() => setActiveSection('support')}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <LifeBuoy className="h-3.5 w-3.5" /> Contact support
              </button>
            </div>
          </aside>

          <main className="space-y-5 lg:col-span-8">
            {active === 'start' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Getting started</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Snout is a real-time communication platform built around servers, channels, direct messages, WebRTC
                  voice, community databases, bots, and SNOUT NITRO. The left rail is your command centre.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Create your account', 'Register with email, verify it, and enable TOTP two-factor authentication in User Settings.'],
                    ['Pick a workspace', 'Join Snout Community Hub or create a server, then invite teammates with an invite code.'],
                    ['Jump anywhere', 'Press Ctrl/Cmd + K to open the quick switcher for channels, DMs, and servers.'],
                    ['Customise your profile', 'Set an avatar, bio, status, and decoration. Nitro unlocks animated avatars and banners.'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                      <div className="text-xs font-semibold text-white">{title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{body}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.07] p-4 text-xs text-indigo-200">
                  <strong className="text-white">Tip:</strong> every page is keyboard reachable and the admin console has
                  a search bar scoped to the active tab.
                </div>
              </div>
            )}

            {active === 'servers' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Servers & channels</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Servers contain categories and channels. Roles are hierarchical and permission bitflags are enforced
                  on the server for every route.
                </p>
                <ul className="space-y-2 text-xs text-slate-300">
                  <li><strong className="text-white">Text / announcement:</strong> Markdown, attachments, reactions, pins, replies, and threads.</li>
                  <li><strong className="text-white">Voice:</strong> WebRTC mesh audio, camera, screen share, push-to-talk, and per-channel bitrate.</li>
                  <li><strong className="text-white">Forum:</strong> Threaded posts for ideas, support, and long-running discussions.</li>
                  <li><strong className="text-white">Permissions:</strong> manage server, channels, roles, messages, members, invites, and webhooks.</li>
                </ul>
                <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-[11px] text-slate-200">{`GET  /api/servers
POST /api/servers
GET  /api/servers/:serverId
POST /api/servers/:serverId/leave`}</pre>
              </div>
            )}

            {active === 'voice' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Voice, video & screen share</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Voice runs on a peer-to-peer WebRTC mesh signalled over Socket.IO. The voice dock shows connection
                  quality, mute, deafen, camera, and screen share controls.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Audio', 'Opus audio, voice activity detection, push-to-talk, and per-user gain.'],
                    ['Video', 'Camera preview and remote tiles with speaking indicators.'],
                    ['Screen share', 'Share a tab, window, or display; Nitro raises quality to 1080p60.'],
                    ['Signalling', 'Socket.IO rooms coordinate offers, answers, and ICE candidates.'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                      <div className="text-xs font-semibold text-white">{title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{body}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4 text-xs text-slate-300">
                  Calls currently use a peer-to-peer mesh with authenticated, short-lived TURN fallback on the
                  configured relay. The optional LiveKit container is not connected to the browser call path yet.
                </div>
              </div>
            )}

            {active === 'databases' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Community databases</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Every server can hold structured collaborative tables — roadmaps, bug logs, directories, and sprint
                  boards. Tables sync live over Socket.IO and are mirrored into the built-in SQLite relational tables.
                </p>
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-xs text-emerald-200">
                  Platform admins manage every community table from <strong className="text-white">Admin Console → Community Databases</strong>:
                  browse rows, edit cells inline, add columns and rows, and export snapshots.
                </div>
                <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-[11px] text-slate-200">{`GET    /api/servers/:serverId/databases
POST   /api/servers/:serverId/databases          # new table
PATCH  /api/servers/:serverId/databases/:tableId # rename / add column
POST   /api/servers/:serverId/databases/:tableId/rows
PATCH  /api/servers/:serverId/databases/:tableId/rows/:rowId`}</pre>
                <p className="text-xs leading-relaxed text-slate-400">
                  Column types: text, number, status, checkbox, date, and URL. Status columns cycle through their option
                  list on click. All writes are permission checked server-side.
                </p>
              </div>
            )}

            {active === 'bots' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Bots & developer API</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Create bot applications in the Developer Portal, rotate tokens, register slash commands, and authorize
                  the bot into servers you manage. Tokens are shown once and stored hashed.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveSection('developer')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
                >
                  Open Developer Portal <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-[11px] text-slate-200">{`POST /api/bots/gateway/channels/:channelId/messages
Authorization: Bot chrd_bot_xxxxxxxxx
Content-Type: application/json

{ "content": "Hello from an external Snout bot!" }`}</pre>
                <p className="text-xs text-slate-400">
                  Webhook events: MESSAGE_CREATE, SLASH_COMMAND, MEMBER_JOIN. Bot logs stream in the Developer Portal so
                  you can debug failed deliveries.
                </p>
              </div>
            )}

            {active === 'billing' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">NITRO & Platega billing</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  SNOUT NITRO is a monthly subscription. Checkout is created server-side and Nitro is activated only by a
                  verified Platega webhook with matching merchant headers, amount, and currency.
                </p>
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-xs text-amber-200">
                  <strong className="text-white">Admin setup:</strong> go to Admin Console → Integrations → Platega, paste
                  your Merchant ID and secret, save, then run <em>Test connection</em>. The webhook URL is generated for you.
                </div>
                <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-[11px] text-slate-200">{`POST /api/payments/platega/webhook
X-MerchantId: <merchant id>
X-Secret: <webhook secret>

{ "id": "...", "amount": 2.00, "currency": "USD", "status": "CONFIRMED" }`}</pre>
                <p className="text-xs text-slate-400">
                  Duplicate CONFIRMED callbacks are idempotent. CHARGEBACKED callbacks revoke Nitro. Admins can manually
                  confirm or refund payments from the Payments tab.
                </p>
              </div>
            )}

            {active === 'trust' && (
              <div className="space-y-5">
                <h2 className="font-display text-xl font-bold text-white">Trust, safety & moderation</h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  Server moderators can kick, ban, timeout, delete messages, and review audit logs. Platform admins can
                  suspend accounts, revoke sessions, reset 2FA, delete servers, and broadcast to every user.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Two-factor authentication', 'TOTP with QR provisioning and one-time backup codes; admins can reset in an emergency.'],
                    ['Session control', 'Every device is a session. Revoke one session or all sessions instantly.'],
                    ['Support escalation', 'Safety tickets are prioritised, and staff replies notify the reporter in real time.'],
                    ['Audit trail', 'Admin and moderation actions are appended to an exportable audit log.'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                      <div className="text-xs font-semibold text-white">{title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-3">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                <Code2 className="h-4 w-4 text-indigo-300" /> REST API quick reference
              </h2>
              <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {API_EXAMPLES.map((endpoint) => (
                      <tr key={`${endpoint.method}-${endpoint.path}`}>
                        <td className="px-3 py-2 font-mono text-emerald-300">{endpoint.method}</td>
                        <td className="px-3 py-2 font-mono text-slate-200">{endpoint.path}</td>
                        <td className="px-3 py-2 text-slate-400">{endpoint.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                Authenticate with <code className="text-slate-300">Authorization: Bearer &lt;session token&gt;</code>.
                Bot gateway routes use <code className="text-slate-300">Authorization: Bot &lt;token&gt;</code>.
              </p>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
