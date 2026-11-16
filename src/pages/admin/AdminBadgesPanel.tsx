import React, { useEffect, useMemo, useState } from 'react';
import { Award, Loader2, Plus, Search, Sparkles, Trash2, UserCheck } from 'lucide-react';
import type { AdminBadge, PublicUser } from '../../../shared/types.ts';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';
import { BadgeChip } from '../../components/BadgeChip.tsx';

interface BadgePanelUser extends PublicUser {
  email: string;
  isSuspended: boolean;
}

export const AdminBadgesPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [badges, setBadges] = useState<AdminBadge[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<BadgePanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🏅');
  const [color, setColor] = useState('#5865F2');
  const [priority, setPriority] = useState(50);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [badgeRes, userRes] = await Promise.all([
        apiRequest<{ badges: AdminBadge[]; usage: Record<string, number> }>('/api/admin/badges'),
        apiRequest<{ users: BadgePanelUser[] }>('/api/admin/users'),
      ]);
      setBadges(badgeRes.badges);
      setUsage(badgeRes.usage);
      setUsers(userRes.users);
      setSelectedUserId((current) => current || userRes.users[0]?.id || '');
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load badges', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await apiRequest('/api/admin/badges', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), description: description.trim(), icon, color, priority }),
      });
      setLabel('');
      setDescription('');
      await load();
      pushToast({ type: 'success', title: 'Badge created' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Create badge failed', description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const toggleUserBadge = async (badgeId: string) => {
    if (!selectedUser) return;
    const current = selectedUser.badgeIds || [];
    const next = current.includes(badgeId)
      ? current.filter((id) => id !== badgeId)
      : [...current, badgeId];
    setSavingUserId(selectedUser.id);
    try {
      const res = await apiRequest<{ user: PublicUser }>(`/api/admin/users/${selectedUser.id}/badges`, {
        method: 'PUT',
        body: JSON.stringify({ badgeIds: next }),
      });
      setUsers((prev) => prev.map((u) => (u.id === res.user.id ? { ...u, ...res.user } : u)));
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Badge update failed', description: (err as Error).message });
    } finally {
      setSavingUserId(null);
    }
  };

  const handleDelete = async (badge: AdminBadge) => {
    if (!window.confirm(`Delete the "${badge.label}" badge? It will be removed from every profile.`)) return;
    try {
      await apiRequest(`/api/admin/badges/${badge.id}`, { method: 'DELETE' });
      await load();
      pushToast({ type: 'info', title: 'Badge deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading badges…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <form onSubmit={handleCreate} className="space-y-3 rounded-xl border border-white/[0.07] bg-[#12151A] p-5 lg:col-span-4">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
            <Plus className="h-4 w-4 text-indigo-300" /> Create a badge
          </div>
          <div className="grid grid-cols-[56px_1fr] gap-2">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              aria-label="Badge icon emoji"
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-2 text-center text-lg"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              minLength={2}
              maxLength={32}
              placeholder="Badge label"
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={160}
            placeholder="Short description shown on hover"
            className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-[11px] text-slate-400">
              Color
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-[11px] text-slate-400">
              Priority
              <input
                type="number"
                min={0}
                max={999}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-transparent font-mono text-xs text-white focus:outline-none"
              />
            </label>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Preview</div>
            <div className="mt-1.5">
              <BadgeChip badge={{ id: 'preview', label: label || 'New badge', description, icon, color, priority, isSystem: false, createdAt: new Date().toISOString() }} size="md" />
            </div>
          </div>
          <button type="submit" disabled={creating} className="w-full rounded-lg bg-[#5865F2] py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">
            {creating ? 'Creating…' : 'Create badge'}
          </button>
        </form>

        <div className="space-y-2 rounded-xl border border-white/[0.07] bg-[#12151A] p-5 lg:col-span-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
              <Award className="h-4 w-4 text-amber-300" /> Badge catalogue ({badges.length})
            </div>
            <span className="font-mono text-[11px] text-slate-500">sorted by priority</span>
          </div>
          <div className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
            {badges.map((badge) => (
              <div key={badge.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0D0F12] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-lg">{badge.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-white">{badge.label}</span>
                      <span className="font-mono text-[10px] text-slate-500">#{badge.priority}</span>
                      {badge.isSystem && <span className="rounded bg-white/[0.06] px-1 py-0.5 text-[9px] text-slate-400">system</span>}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">{badge.description || 'No description'}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">{usage[badge.id] || 0} awarded</span>
                  {!badge.isSystem && (
                    <button type="button" onClick={() => void handleDelete(badge)} className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300" title="Delete badge">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
            <UserCheck className="h-4 w-4 text-emerald-300" /> Award badges to a member
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Find a user…"
              className="w-56 rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="max-h-64 space-y-1 overflow-y-auto lg:col-span-4">
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedUserId(u.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left ${
                  selectedUserId === u.id ? 'border-[#5865F2]/60 bg-[#5865F2]/10' : 'border-white/[0.06] hover:bg-white/[0.03]'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-white">@{u.username}</span>
                  <span className="block truncate text-[10px] text-slate-500">{u.displayName}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500">{(u.badgeIds || []).length}</span>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8">
            {selectedUser ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0D0F12] px-3 py-2">
                  <div>
                    <div className="text-xs font-semibold text-white">@{selectedUser.username}</div>
                    <div className="text-[10px] text-slate-500">{selectedUser.email}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(selectedUser.badges || []).length > 0 ? (
                      selectedUser.badges!.map((b) => <BadgeChip key={b.id} badge={b} />)
                    ) : (
                      <span className="text-[10px] text-slate-500">No badges yet</span>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {badges.map((badge) => {
                    const assigned = (selectedUser.badgeIds || []).includes(badge.id);
                    return (
                      <button
                        key={badge.id}
                        type="button"
                        disabled={savingUserId === selectedUser.id}
                        onClick={() => void toggleUserBadge(badge.id)}
                        aria-pressed={assigned}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                          assigned ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/[0.08] bg-[#0D0F12] hover:border-white/20'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-base">{badge.icon}</span>
                          <span className="text-xs font-medium text-slate-200">{badge.label}</span>
                        </span>
                        <span className={`text-[10px] font-semibold ${assigned ? 'text-emerald-300' : 'text-slate-500'}`}>
                          {assigned ? 'Awarded' : 'Award'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 p-8 text-xs text-slate-500">
                Select a member to award badges.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
