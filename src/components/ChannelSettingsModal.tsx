import React, { useEffect, useState } from 'react';
import { Lock, Save, Shield, Trash2, X } from 'lucide-react';
import { PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

export const ChannelSettingsModal: React.FC = () => {
  const {
    editingChannel,
    serverBundle,
    setEditingChannel,
    refreshServers,
    pushToast,
  } = useChordStore();

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (editingChannel) {
      setName(editingChannel.name);
      setTopic(editingChannel.topic || '');
      setIsPrivate(editingChannel.isPrivate);
      setConfirmDelete(false);
    }
  }, [editingChannel]);

  if (!editingChannel || !serverBundle) return null;

  const canManageRoles = hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_ROLES);
  const currentChannel =
    serverBundle.channels.find((c) => c.id === editingChannel.id) || editingChannel;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiRequest(`/api/channels/${editingChannel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          topic: topic.trim(),
          isPrivate,
        }),
      });
      await refreshServers();
      pushToast({
        type: 'success',
        title: 'Channel updated',
        description: `#${name.trim()} settings saved.`,
      });
      setEditingChannel(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRoleRead = async (roleId: string) => {
    const existing = currentChannel.overrides.find(
      (o) => o.targetType === 'ROLE' && o.targetId === roleId
    );
    const isCurrentlyDenied = existing ? (existing.deny & PERMISSIONS.READ_MESSAGES) !== 0 : false;
    const isCurrentlyAllowed = existing ? (existing.allow & PERMISSIONS.READ_MESSAGES) !== 0 : false;

    let nextAllow = existing?.allow ?? 0;
    let nextDeny = existing?.deny ?? 0;

    if (isCurrentlyDenied) {
      nextDeny &= ~PERMISSIONS.READ_MESSAGES;
      nextAllow |= PERMISSIONS.READ_MESSAGES;
    } else if (isCurrentlyAllowed) {
      nextAllow &= ~PERMISSIONS.READ_MESSAGES;
      nextDeny |= PERMISSIONS.READ_MESSAGES;
    } else {
      nextDeny |= PERMISSIONS.READ_MESSAGES;
    }

    try {
      await apiRequest(`/api/channels/${currentChannel.id}/overrides`, {
        method: 'PUT',
        body: JSON.stringify({
          targetType: 'ROLE',
          targetId: roleId,
          allow: nextAllow,
          deny: nextDeny,
        }),
      });
      await refreshServers();
      pushToast({ type: 'success', title: 'Channel override updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Override failed', description: (err as Error).message });
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await apiRequest(`/api/channels/${editingChannel.id}`, { method: 'DELETE' });
      await refreshServers();
      pushToast({
        type: 'info',
        title: 'Channel deleted',
        description: `#${editingChannel.name} was removed.`,
      });
      setEditingChannel(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setEditingChannel(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12151A] p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-white">Channel Settings</h2>
            <p className="text-xs text-slate-400">
              #{editingChannel.name} · {editingChannel.type}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditingChannel(null)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Channel Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Channel Topic</span>
            <textarea
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe what belongs in this channel..."
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#171A21] p-3.5 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-slate-400" />
              <div>
                <div className="text-xs font-semibold text-white">Private Channel</div>
                <div className="text-[11px] text-slate-400">
                  Restrict visibility using role overrides below.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="h-4 w-4 accent-[#5865F2]"
            />
          </label>

          {canManageRoles && (
            <div className="space-y-2 border-t border-white/[0.06] pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Shield className="h-3.5 w-3.5" />
                <span>Role Read Access Overrides</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {serverBundle.roles.map((r) => {
                  const ov = currentChannel.overrides.find(
                    (o) => o.targetType === 'ROLE' && o.targetId === r.id
                  );
                  const denied = ov ? (ov.deny & PERMISSIONS.READ_MESSAGES) !== 0 : false;
                  const allowed = ov ? (ov.allow & PERMISSIONS.READ_MESSAGES) !== 0 : false;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-[#171A21] px-3 py-2 text-xs"
                    >
                      <span className="flex items-center gap-2 text-slate-200">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: r.color }}
                        />
                        {r.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleToggleRoleRead(r.id)}
                        className={`rounded-md px-2.5 py-1 font-mono text-[11px] ${
                          denied
                            ? 'bg-rose-500/20 text-rose-300'
                            : allowed
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {denied ? 'Denied' : allowed ? 'Allowed' : 'Inherit'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Channel</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg bg-white/5 px-2.5 py-2 text-xs text-slate-300"
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
