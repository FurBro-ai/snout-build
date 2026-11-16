import React, { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Key,
  Plus,
  Save,
  Search,
  Server as ServerIcon,
  Terminal,
  Webhook,
} from 'lucide-react';
import type { BotApp, BotLog } from '../../shared/types.ts';
import { PERMISSIONS } from '../../shared/constants.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

export const DeveloperPortalPage: React.FC = () => {
  const { servers, refreshServers, pushToast } = useChordStore();
  const [bots, setBots] = useState<BotApp[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [botSearch, setBotSearch] = useState('');
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [newBotName, setNewBotName] = useState('');
  const [newBotDesc, setNewBotDesc] = useState('');
  const [newBotWebhook, setNewBotWebhook] = useState('');
  const [editWebhook, setEditWebhook] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPermissions, setEditPermissions] = useState(0);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [cmdName, setCmdName] = useState('');
  const [cmdDesc, setCmdDesc] = useState('');
  const [installServerId, setInstallServerId] = useState('');

  const loadBots = async () => {
    const res = await apiRequest<{ bots: BotApp[] }>('/api/bots/mine');
    setBots(res.bots);
    if (!selectedBotId && res.bots.length > 0) {
      setSelectedBotId(res.bots[0].id);
    }
  };

  useEffect(() => {
    void loadBots();
  }, []);

  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;

  useEffect(() => {
    if (!selectedBot) return;
    setEditWebhook(selectedBot.webhookUrl || '');
    setEditDesc(selectedBot.description || '');
    setEditPermissions(selectedBot.permissions);
    void apiRequest<{ logs: BotLog[] }>(`/api/bots/${selectedBot.id}/logs`)
      .then((res) => setLogs(res.logs))
      .catch(() => {});
  }, [selectedBot?.id]);

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ bot: BotApp; botToken: string }>('/api/bots', {
        method: 'POST',
        body: JSON.stringify({
          name: newBotName.trim(),
          description: newBotDesc.trim(),
          webhookUrl: newBotWebhook.trim() || null,
        }),
      });
      setNewBotName('');
      setNewBotDesc('');
      setNewBotWebhook('');
      setRevealedToken(res.botToken);
      setSelectedBotId(res.bot.id);
      await loadBots();
      pushToast({ type: 'success', title: `Created bot ${res.bot.name}` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Bot creation failed', description: (err as Error).message });
    }
  };

  const handleSaveBotConfig = async () => {
    if (!selectedBot) return;
    try {
      await apiRequest(`/api/bots/${selectedBot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: editDesc.trim(),
          webhookUrl: editWebhook.trim() || null,
          permissions: editPermissions,
        }),
      });
      await loadBots();
      pushToast({ type: 'success', title: 'Bot configuration saved' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    }
  };

  const handleRotateToken = async (botId: string) => {
    try {
      const res = await apiRequest<{ bot: BotApp; botToken: string }>(`/api/bots/${botId}/rotate-token`, {
        method: 'POST',
      });
      setRevealedToken(res.botToken);
      await loadBots();
      pushToast({ type: 'info', title: 'Bot token rotated', description: 'Copy the new token immediately.' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Token rotation failed', description: (err as Error).message });
    }
  };

  const handleRegisterCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBot || !cmdName.trim()) return;
    try {
      await apiRequest(`/api/bots/${selectedBot.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({ name: cmdName.trim(), description: cmdDesc.trim() || 'Custom slash command' }),
      });
      setCmdName('');
      setCmdDesc('');
      pushToast({ type: 'success', title: 'Slash command registered' });
      await loadBots();
    } catch (err) {
      pushToast({ type: 'error', title: 'Command error', description: (err as Error).message });
    }
  };

  const handleAuthorizeServer = async () => {
    if (!selectedBot || !installServerId) return;
    try {
      await apiRequest(`/api/bots/${selectedBot.id}/authorize`, {
        method: 'POST',
        body: JSON.stringify({ serverId: installServerId }),
      });
      pushToast({ type: 'success', title: 'Bot authorized via OAuth2' });
      await loadBots();
      await refreshServers();
    } catch (err) {
      pushToast({ type: 'error', title: 'Authorization failed', description: (err as Error).message });
    }
  };

  const filteredBots = bots.filter((b) =>
    b.name.toLowerCase().includes(botSearch.trim().toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0F12] text-[#F1F3F5] p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Snout Developer Portal</h1>
            <p className="mt-1 text-sm text-slate-400">
              Register bot applications, manage OAuth2 server authorizations, slash commands, webhooks, and tokens.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column: Create + Bot List */}
          <div className="lg:col-span-4 space-y-6">
            <form
              onSubmit={handleCreateBot}
              className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-3"
            >
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                <Plus className="h-4 w-4 text-[#5865F2]" />
                <span>Create Bot Application</span>
              </div>
              <input
                type="text"
                required
                minLength={2}
                value={newBotName}
                onChange={(e) => setNewBotName(e.target.value)}
                placeholder="Bot name (e.g. StudioMod)"
                className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <input
                type="text"
                value={newBotDesc}
                onChange={(e) => setNewBotDesc(e.target.value)}
                placeholder="Description"
                className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <input
                type="url"
                value={newBotWebhook}
                onChange={(e) => setNewBotWebhook(e.target.value)}
                placeholder="Interactions webhook URL (optional)"
                className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full rounded-lg bg-[#5865F2] py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
              >
                Create Bot
              </button>
            </form>

            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-3 space-y-2">
              <div className="px-2 py-1 text-xs font-semibold text-slate-400">
                Your Applications ({bots.length})
              </div>
              {bots.length > 0 && (
                <div className="relative px-1">
                  <Search className="pointer-events-none absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={botSearch}
                    onChange={(e) => setBotSearch(e.target.value)}
                    placeholder="Filter bots..."
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-2.5 text-xs text-white"
                  />
                </div>
              )}
              {filteredBots.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-500">
                  {bots.length === 0
                    ? 'No developer bots created yet. Built-in Snout Sentinel is active in Snout Community Hub.'
                    : 'No bots match your search.'}
                </p>
              ) : (
                filteredBots.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => {
                      setSelectedBotId(bot.id);
                      setRevealedToken(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      selectedBotId === bot.id
                        ? 'bg-[#262B36] text-white'
                        : 'text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <Bot className="h-4 w-4 text-[#5865F2] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{bot.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {bot.slashCommands.length} commands · {bot.installedServerIds.length} servers
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Selected Bot Config + API Docs */}
          <div className="lg:col-span-8 space-y-6">
            {revealedToken && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
                <div className="text-xs font-semibold text-amber-300">
                  Bot Token Generated (Copy now — it will not be displayed again)
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white break-all">
                    {revealedToken}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(revealedToken);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {selectedBot ? (
              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-white">{selectedBot.name}</h2>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">
                      Bot ID: {selectedBot.id} · Token Prefix: {selectedBot.tokenPrefix}...
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRotateToken(selectedBot.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1E222B] px-3 py-2 text-xs font-medium text-white hover:bg-[#262B36]"
                  >
                    <Key className="h-3.5 w-3.5" />
                    <span>Rotate Bot Token</span>
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 border-t border-white/[0.06] pt-4">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-400">Description</span>
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-400">Interactions Webhook URL</span>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={editWebhook}
                        onChange={(e) => setEditWebhook(e.target.value)}
                        placeholder="https://example.com/interactions"
                        className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveBotConfig()}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#1E222B] px-3 py-2 text-xs font-medium text-white hover:bg-[#262B36]"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>Save</span>
                      </button>
                    </div>
                  </label>
                </div>

                <section className="space-y-2 border-t border-white/[0.06] pt-4">
                  <div className="text-xs font-semibold text-slate-300">Bot permission scopes</div>
                  <p className="text-[11px] text-slate-500">Scopes are checked in addition to each channel’s server permissions.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ['Read messages', PERMISSIONS.READ_MESSAGES],
                      ['Send messages', PERMISSIONS.SEND_MESSAGES],
                      ['Connect to voice', PERMISSIONS.CONNECT_VOICE],
                      ['Speak in voice', PERMISSIONS.SPEAK_VOICE],
                      ['Share screen', PERMISSIONS.SCREEN_SHARE],
                    ].map(([label, permission]) => {
                      const flag = permission as number;
                      return (
                        <label key={flag} className="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={(editPermissions & flag) === flag}
                            onChange={() => setEditPermissions((current) => current & flag ? current & ~flag : current | flag)}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </section>

                {/* OAuth2 Authorize to Server */}
                <div className="border-t border-white/[0.06] pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <ServerIcon className="h-3.5 w-3.5" />
                    <span>OAuth2 Server Installation</span>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={installServerId}
                      onChange={(e) => setInstallServerId(e.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                    >
                      <option value="">Select a server you manage...</option>
                      {servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleAuthorizeServer()}
                      className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
                    >
                      Authorize Bot
                    </button>
                  </div>
                </div>

                {/* Slash Commands Builder */}
                <div className="border-t border-white/[0.06] pt-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Slash Commands</span>
                  </div>
                  <form onSubmit={handleRegisterCommand} className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      required
                      value={cmdName}
                      onChange={(e) => setCmdName(e.target.value)}
                      placeholder="command (without /)"
                      className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white"
                    />
                    <input
                      type="text"
                      value={cmdDesc}
                      onChange={(e) => setCmdDesc(e.target.value)}
                      placeholder="Command description"
                      className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-[#1E222B] px-3 py-2 text-xs font-semibold text-white hover:bg-[#262B36]"
                    >
                      Register Command
                    </button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {selectedBot.slashCommands.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono font-semibold text-indigo-300">/{c.name}</span>
                        <span className="ml-2 text-slate-400">{c.description}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bot Logs */}
                <div className="border-t border-white/[0.06] pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <Webhook className="h-3.5 w-3.5" />
                    <span>Recent Bot Execution Logs</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3 font-mono text-[11px] space-y-1">
                    {logs.length === 0 ? (
                      <div className="text-slate-500">No execution events logged yet.</div>
                    ) : (
                      logs.map((l) => (
                        <div key={l.id} className="text-slate-300">
                          <span className="text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</span>{' '}
                          <span className="text-indigo-300">[{l.event}]</span> {l.message}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Live Bot REST API Reference */}
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-6 space-y-3">
              <h3 className="font-display text-base font-semibold text-white">Bot Gateway & REST API</h3>
              <p className="text-xs text-slate-400">
                Authenticate external bot processes using your <code className="font-mono text-white">Bot &lt;token&gt;</code> header to post messages to any authorized channel:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-xs text-slate-200">
{`POST /api/bots/gateway/channels/:channelId/messages
Authorization: Bot chrd_bot_...
Content-Type: application/json

{ "content": "Hello from an external Snout bot!" }`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
