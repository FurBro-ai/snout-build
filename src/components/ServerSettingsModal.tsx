import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Shield, Sparkles, Trash2, Upload, Webhook, X } from 'lucide-react';
import { ANIMATED_BANNER_PRESETS, PERMISSION_LABELS } from '../../shared/constants.ts';
import type { AuditLogEntry, ChannelWebhook, Role, ServerBan } from '../../shared/types.ts';
import { apiRequest, uploadFileToServer } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { AnimatedBanner } from './AnimatedBanner.tsx';

interface ServerSettingsModalProps {
  onClose: () => void;
}

type ServerTab = 'overview' | 'roles' | 'webhooks' | 'bans' | 'audit';

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({ onClose }) => {
  const { user, serverBundle, refreshServers, setActiveSection, pushToast } = useChordStore();
  const [tab, setTab] = useState<ServerTab>('overview');
  const [name, setName] = useState(serverBundle?.server.name || '');
  const [description, setDescription] = useState(serverBundle?.server.description || '');
  const [isPublic, setIsPublic] = useState(Boolean(serverBundle?.server.isPublic));
  const [iconUrl, setIconUrl] = useState(serverBundle?.server.iconUrl || '');
  const [bannerUrl, setBannerUrl] = useState(serverBundle?.server.bannerUrl || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(
    serverBundle?.roles[0]?.id || null
  );
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#5865F2');

  const [webhooks, setWebhooks] = useState<ChannelWebhook[]>([]);
  const [webhookChannelId, setWebhookChannelId] = useState(serverBundle?.channels[0]?.id || '');
  const [webhookName, setWebhookName] = useState('');
  const [bans, setBans] = useState<ServerBan[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const serverId = serverBundle?.server.id || null;

  useEffect(() => {
    if (!serverId) return;
    if (tab === 'webhooks') {
      void apiRequest<{ webhooks: ChannelWebhook[] }>(`/api/bots/webhooks/server/${serverId}`)
        .then((r) => setWebhooks(r.webhooks))
        .catch(() => {});
    } else if (tab === 'bans') {
      void apiRequest<{ bans: ServerBan[] }>(`/api/servers/${serverId}/bans`)
        .then((r) => setBans(r.bans))
        .catch(() => {});
    } else if (tab === 'audit') {
      void apiRequest<{ logs: AuditLogEntry[] }>(`/api/servers/${serverId}/audit-logs`)
        .then((r) => setAuditLogs(r.logs))
        .catch(() => {});
    }
  }, [serverId, tab]);

  if (!serverBundle) return null;
  const { server, roles, channels } = serverBundle;
  const selectedRole: Role | undefined = roles.find((r) => r.id === selectedRoleId);

  const handleSaveOverview = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/servers/${server.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description,
          isPublic,
          iconUrl: iconUrl || null,
          bannerUrl: bannerUrl || null,
        }),
      });
      await refreshServers();
      pushToast({ type: 'success', title: 'Server settings updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    }
  };

  const handleUploadAsset = async (e: React.ChangeEvent<HTMLInputElement>, target: 'icon' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadFileToServer(file, file.name);
      if (target === 'icon') setIconUrl(res.attachment.url);
      else setBannerUrl(res.attachment.url);
      pushToast({ type: 'info', title: `${target === 'icon' ? 'Icon' : 'Banner'} uploaded — click Save Changes` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Upload failed', description: (err as Error).message });
    }
    e.target.value = '';
  };

  const handleDeleteServer = async () => {
    try {
      await apiRequest(`/api/servers/${server.id}`, { method: 'DELETE' });
      setActiveSection('home');
      await refreshServers();
      pushToast({ type: 'info', title: `Deleted ${server.name}` });
      onClose();
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    try {
      const res = await apiRequest<{ role: Role }>(`/api/servers/${server.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ name: newRoleName.trim(), color: newRoleColor }),
      });
      setNewRoleName('');
      setSelectedRoleId(res.role.id);
      await refreshServers();
      pushToast({ type: 'success', title: `Role "${res.role.name}" created` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Role creation failed', description: (err as Error).message });
    }
  };

  const handleTogglePermission = async (role: Role, flag: number) => {
    const nextPerms = (role.permissions & flag) === flag ? role.permissions & ~flag : role.permissions | flag;
    try {
      await apiRequest(`/api/servers/${server.id}/roles/${role.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: nextPerms }),
      });
      await refreshServers();
    } catch (err) {
      pushToast({ type: 'error', title: 'Permission update failed', description: (err as Error).message });
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookChannelId) return;
    try {
      const res = await apiRequest<{ webhook: ChannelWebhook }>(`/api/bots/webhooks/channel/${webhookChannelId}`, {
        method: 'POST',
        body: JSON.stringify({ name: webhookName.trim() || 'Snout Webhook' }),
      });
      setWebhookName('');
      setWebhooks((w) => [...w, res.webhook]);
      pushToast({ type: 'success', title: 'Webhook created' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Webhook failed', description: (err as Error).message });
    }
  };

  const handleUnban = async (userId: string) => {
    try {
      await apiRequest(`/api/servers/${server.id}/ban/${userId}`, { method: 'DELETE' });
      setBans((b) => b.filter((x) => x.userId !== userId));
      pushToast({ type: 'info', title: 'User unbanned' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Unban failed', description: (err as Error).message });
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
        className="flex h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#12151A] shadow-2xl"
      >
        <nav className="w-52 shrink-0 border-r border-white/[0.06] bg-[#0D0F12] p-4 space-y-1 text-xs">
          <div className="px-3 pb-2 font-semibold text-slate-400 truncate">{server.name}</div>
          {([
            ['overview', 'Server Overview'],
            ['roles', 'Roles & Permissions'],
            ['webhooks', 'Channel Webhooks'],
            ['bans', 'Bans'],
            ['audit', 'Audit Logs'],
          ] as Array<[ServerTab, string]>).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`w-full rounded-lg px-3 py-2 text-left font-medium transition-colors ${
                tab === k ? 'bg-[#262B36] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
            <h2 className="font-display text-lg font-bold text-white capitalize">{tab}</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {tab === 'overview' && (
            <form onSubmit={handleSaveOverview} className="space-y-5 max-w-2xl">
              {/* Live Server Header Preview */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#171A21]">
                <AnimatedBanner
                  bannerUrl={bannerUrl || null}
                  fallbackImage="/src/assets/images/chord_server_synth_1794745770689.jpg"
                  className="h-28"
                  showAnimatedLabel
                />
                <div className="px-5 pb-4 -mt-8 relative z-10 flex items-end gap-3.5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 border-[#171A21] bg-[#262B36] flex items-center justify-center font-display text-lg font-bold text-white shadow-lg">
                    {iconUrl ? (
                      <img src={iconUrl} alt={name} className="h-full w-full object-cover" />
                    ) : (
                      (name || 'S').slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="pb-1 min-w-0">
                    <div className="font-display text-base font-bold text-white truncate">{name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {description || 'Public Snout server'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-slate-300">Server Name</span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#171A21] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1E222B]">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload Icon</span>
                    <input type="file" accept="image/*" onChange={(e) => void handleUploadAsset(e, 'icon')} className="hidden" />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload GIF / Banner</span>
                    <input type="file" accept="image/*,.gif,.webp" onChange={(e) => void handleUploadAsset(e, 'banner')} className="hidden" />
                  </label>
                </div>
              </div>

              <label className="block space-y-1.5 text-xs">
                <span className="font-medium text-slate-300">Description</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                />
              </label>

              {/* Animated Server Banner Preset Selector */}
              <div className="rounded-xl border border-white/[0.08] bg-[#171A21] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-white">
                    <Sparkles className="h-3.5 w-3.5 text-[#818CF8]" />
                    <span>Animated Server Banner</span>
                  </span>
                  {bannerUrl && (
                    <button
                      type="button"
                      onClick={() => setBannerUrl('')}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      Clear Banner
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {ANIMATED_BANNER_PRESETS.map((preset) => {
                    const active = bannerUrl === preset.token;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setBannerUrl(preset.token)}
                        className={`overflow-hidden rounded-lg border text-left transition-all ${
                          active
                            ? 'border-[#5865F2] ring-1 ring-[#5865F2]/60'
                            : 'border-white/10 hover:border-white/25'
                        }`}
                      >
                        <AnimatedBanner bannerUrl={preset.token} className="h-11" />
                        <div className="bg-[#0D0F12] px-2.5 py-1.5">
                          <div className="text-[11px] font-semibold text-white truncate">{preset.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="rounded border-white/20"
                />
                <span>List in Public Server Discovery</span>
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button type="submit" className="rounded-lg bg-[#5865F2] px-5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]">
                  Save Changes
                </button>
                {server.ownerId === user?.id && !confirmDelete && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600/20 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-600/35"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Server</span>
                  </button>
                )}
                {server.ownerId === user?.id && confirmDelete && (
                  <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs">
                    <span className="text-rose-200">Delete permanently?</span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteServer()}
                      className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-slate-300 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </form>
          )}

          {tab === 'roles' && (
            <div className="grid gap-6 md:grid-cols-12">
              <div className="md:col-span-4 space-y-3">
                <form onSubmit={handleCreateRole} className="flex gap-1.5">
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="New role..."
                    className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="color"
                    value={newRoleColor}
                    onChange={(e) => setNewRoleColor(e.target.value)}
                    className="h-8 w-8 rounded border border-white/10 bg-transparent"
                  />
                  <button type="submit" className="rounded-lg bg-[#5865F2] p-1.5 text-white">
                    <Plus className="h-4 w-4" />
                  </button>
                </form>

                <div className="space-y-1">
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRoleId(r.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                        selectedRoleId === r.id ? 'bg-[#262B36] text-white' : 'text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-8 space-y-3">
                {selectedRole ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-display text-sm font-bold text-white">
                        <Shield className="h-4 w-4 text-[#5865F2]" />
                        <span>{selectedRole.name} Permissions</span>
                      </div>
                    </div>
                    <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-[#171A21]">
                      {PERMISSION_LABELS.map((perm) => {
                        const enabled = (selectedRole.permissions & perm.flag) === perm.flag;
                        return (
                          <label
                            key={perm.key}
                            className="flex items-center justify-between gap-4 px-4 py-3 text-xs cursor-pointer hover:bg-white/[0.02]"
                          >
                            <div>
                              <div className="font-semibold text-white">{perm.label}</div>
                              <div className="text-slate-400">{perm.description}</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => void handleTogglePermission(selectedRole, perm.flag)}
                              className="h-4 w-4 accent-[#5865F2]"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">Select a role to configure permissions.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'webhooks' && (
            <div className="space-y-4">
              <form onSubmit={handleCreateWebhook} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={webhookName}
                  onChange={(e) => setWebhookName(e.target.value)}
                  placeholder="Webhook name"
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                />
                <select
                  value={webhookChannelId}
                  onChange={(e) => setWebhookChannelId(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                >
                  {channels.filter((c) => c.type !== 'VOICE').map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white">
                  Create Webhook
                </button>
              </form>

              <div className="space-y-2">
                {webhooks.map((w) => (
                  <div key={w.id} className="rounded-xl border border-white/[0.07] bg-[#171A21] p-4 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <Webhook className="h-4 w-4 text-[#5865F2]" />
                      <span>{w.name}</span>
                    </div>
                    <code className="block font-mono text-[11px] text-indigo-300 break-all">
                      POST /api/bots/webhooks/execute/{w.id}/{w.token}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'bans' && (
            <div className="space-y-2">
              {bans.length === 0 ? (
                <p className="text-xs text-slate-500">No banned users in this server.</p>
              ) : (
                bans.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#171A21] px-4 py-3 text-xs">
                    <div>
                      <div className="font-semibold text-white">@{b.user?.username || b.userId}</div>
                      <div className="text-slate-400">Reason: {b.reason}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUnban(b.userId)}
                      className="rounded-lg bg-[#262B36] px-3 py-1.5 text-white hover:bg-white/15"
                    >
                      Unban
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-2 font-mono text-xs">
              {auditLogs.length === 0 ? (
                <p className="text-slate-500">No audit events recorded yet.</p>
              ) : (
                auditLogs.map((l) => (
                  <div key={l.id} className="flex justify-between gap-4 border-b border-white/[0.05] pb-2">
                    <div>
                      <span className="text-indigo-300">[{l.action}]</span> {l.actorName}: {l.details}
                    </div>
                    <span className="shrink-0 text-slate-500">{new Date(l.createdAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
