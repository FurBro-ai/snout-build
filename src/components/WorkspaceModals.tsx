import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Compass, Copy, Plus, Sparkles, Users, X } from 'lucide-react';
import { ANIMATED_BANNER_PRESETS } from '../../shared/constants.ts';
import type { ChannelType, Server, ServerInvite } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { AnimatedBanner } from './AnimatedBanner.tsx';

export const CreateOrJoinServerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { refreshServers, selectServer, pushToast } = useChordStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState<string>(ANIMATED_BANNER_PRESETS[0].token);
  const [isPublic, setIsPublic] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ server: Server }>('/api/servers', {
        method: 'POST',
        body: JSON.stringify({ name, description, isPublic, bannerUrl: bannerUrl || null }),
      });
      await refreshServers();
      await selectServer(res.server.id);
      pushToast({ type: 'success', title: `Created ${res.server.name}` });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleJoinInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const code = inviteCode.trim().split('/').pop() || inviteCode.trim();
      const res = await apiRequest<{ server: Server }>(`/api/servers/invites/${encodeURIComponent(code)}/join`, {
        method: 'POST',
      });
      await refreshServers();
      await selectServer(res.server.id);
      pushToast({ type: 'success', title: `Joined ${res.server.name}` });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">Create or Join a Server</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-200">{error}</div>}

        <form onSubmit={handleCreate} className="space-y-3">
          <div className="text-xs font-semibold text-slate-300">Create New Server</div>
          <input
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Server name (e.g. Synth Studio)"
            className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description..."
            className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1 font-medium text-slate-300">
                <Sparkles className="h-3 w-3 text-[#818CF8]" />
                <span>Animated Server Banner</span>
              </span>
              {bannerUrl && (
                <button type="button" onClick={() => setBannerUrl('')} className="hover:text-white">
                  None
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {ANIMATED_BANNER_PRESETS.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setBannerUrl(p.token)}
                  className={`overflow-hidden rounded-lg border text-left transition-all ${
                    bannerUrl === p.token ? 'border-[#5865F2] ring-1 ring-[#5865F2]/60' : 'border-white/10'
                  }`}
                >
                  <AnimatedBanner bannerUrl={p.token} className="h-8" />
                  <div className="bg-[#0D0F12] px-1.5 py-1 text-[10px] font-medium text-white truncate">
                    {p.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span>Discoverable in Public Server Directory</span>
          </label>
          <button type="submit" className="w-full rounded-lg bg-[#5865F2] py-2 text-sm font-semibold text-white hover:bg-[#4752C4]">
            Create Server
          </button>
        </form>

        <div className="border-t border-white/10 pt-4">
          <form onSubmit={handleJoinInvite} className="space-y-2.5">
            <div className="text-xs font-semibold text-slate-300">Have an Invite Code?</div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="e.g. SNOUTHUB"
                className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white"
              />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
                Join
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export const DiscoveryModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { refreshServers, selectServer, pushToast } = useChordStore();
  const [servers, setServers] = useState<Server[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    void apiRequest<{ servers: Server[] }>(`/api/servers/discover?q=${encodeURIComponent(q)}`)
      .then((res) => setServers(res.servers))
      .catch(() => {});
  }, [q]);

  const handleJoin = async (serverId: string) => {
    try {
      await apiRequest(`/api/servers/${serverId}/join`, { method: 'POST' });
      await refreshServers();
      await selectServer(serverId);
      onClose();
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not join server', description: (err as Error).message });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-display text-lg font-bold text-white">
            <Compass className="h-5 w-5 text-[#5865F2]" />
            <span>Discover Public Servers</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search communities..."
          className="w-full rounded-xl border border-white/10 bg-[#0D0F12] px-4 py-2.5 text-sm text-white"
        />

        <div className="grid gap-3 sm:grid-cols-2 max-h-96 overflow-y-auto">
          {servers.map((s) => (
            <div key={s.id} className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#171A21] flex flex-col justify-between">
              <div>
                <AnimatedBanner
                  bannerUrl={s.bannerUrl}
                  fallbackImage="/src/assets/images/chord_server_synth_1794745770689.jpg"
                  className="h-16"
                />
                <div className="p-4">
                  <div className="font-display text-sm font-bold text-white">{s.name}</div>
                  <p className="mt-1 text-xs text-slate-400 line-clamp-2">{s.description || 'Public Snout server'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-xs">
                <span className="font-mono text-slate-400 tabular-nums">{s.memberCount || 1} members</span>
                <button
                  type="button"
                  onClick={() => void handleJoin(s.id)}
                  className="rounded-lg bg-[#5865F2] px-3 py-1.5 font-semibold text-white hover:bg-[#4752C4]"
                >
                  Join Server
                </button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export const CreateChannelModal: React.FC<{ categoryId?: string; onClose: () => void }> = ({
  categoryId,
  onClose,
}) => {
  const { serverBundle, refreshServers, selectChannel } = useChordStore();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [type, setType] = useState<ChannelType>('TEXT');
  const [isPrivate, setIsPrivate] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverBundle) return;
    const res = await apiRequest<{ channel: { id: string } }>(`/api/servers/${serverBundle.server.id}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, topic, type, categoryId: categoryId || null, isPrivate }),
    });
    await refreshServers();
    await selectChannel(res.channel.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">Create Channel</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {(['TEXT', 'VOICE', 'ANNOUNCEMENT', 'FORUM'] as ChannelType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border py-2 font-medium ${
                type === t ? 'border-[#5865F2] bg-[#5865F2]/20 text-white' : 'border-white/10 bg-[#0D0F12] text-slate-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="channel-name"
          className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
        />
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Channel topic (optional)"
          className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
        />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>Private Channel (role/user override required)</span>
        </label>
        <button type="submit" className="w-full rounded-lg bg-[#5865F2] py-2 text-sm font-semibold text-white">
          Create Channel
        </button>
      </form>
    </div>
  );
};

export const InviteModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { serverBundle } = useChordStore();
  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!serverBundle) return;
    void apiRequest<{ invites: ServerInvite[] }>(`/api/servers/${serverBundle.server.id}/invites`)
      .then((res) => setInvites(res.invites))
      .catch(() => {});
  }, [serverBundle]);

  const handleGenerate = async () => {
    if (!serverBundle) return;
    const res = await apiRequest<{ invite: ServerInvite }>(`/api/servers/${serverBundle.server.id}/invites`, {
      method: 'POST',
      body: JSON.stringify({ expiresHours: 168 }),
    });
    setInvites((prev) => [res.invite, ...prev]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">Invite People</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleGenerate()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          <span>Generate New Invite Code</span>
        </button>

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {invites.map((inv) => (
            <div key={inv.code} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2">
              <div>
                <div className="font-mono text-sm font-bold text-white">{inv.code}</div>
                <div className="text-[11px] text-slate-400">Uses: {inv.uses}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(inv.code);
                  setCopiedCode(inv.code);
                  setTimeout(() => setCopiedCode(null), 1500);
                }}
                className="rounded bg-[#1E222B] px-2.5 py-1.5 text-xs text-white"
              >
                {copiedCode === inv.code ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const GroupDmModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { friends, refreshDms, selectThread } = useChordStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    const res = await apiRequest<{ thread: { id: string } }>('/api/dms', {
      method: 'POST',
      body: JSON.stringify({
        participantIds: selectedIds,
        isGroup: selectedIds.length > 1 || Boolean(groupName.trim()),
        name: groupName.trim() || undefined,
      }),
    });
    await refreshDms();
    await selectThread(res.thread.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <form onSubmit={handleCreate} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-display text-lg font-bold text-white">
            <Users className="h-5 w-5 text-[#5865F2]" />
            <span>New Direct / Group Message</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Group name (optional for 2+ friends)"
          className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
        />

        <div className="max-h-56 overflow-y-auto space-y-1.5">
          {friends.length === 0 ? (
            <p className="text-xs text-slate-500">Add friends first to start a Group DM.</p>
          ) : (
            friends.map((f) => (
              <label key={f.id} className="flex items-center justify-between rounded-lg bg-[#171A21] px-3 py-2 text-xs cursor-pointer">
                <span className="text-white">{f.user.displayName} (@{f.user.username})</span>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(f.user.id)}
                  onChange={() => toggle(f.user.id)}
                  className="accent-[#5865F2]"
                />
              </label>
            ))
          )}
        </div>

        <button
          type="submit"
          disabled={selectedIds.length === 0}
          className="w-full rounded-lg bg-[#5865F2] py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Start Conversation
        </button>
      </form>
    </div>
  );
};
