import React, { useState } from 'react';
import { Crown, ExternalLink, Search, Shield, UserPlus } from 'lucide-react';
import { PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import type { ServerMember } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { BadgeRow } from './BadgeChip.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export const MemberList: React.FC = () => {
  const {
    user,
    serverBundle,
    refreshServers,
    refreshDms,
    selectThread,
    setInspectedUser,
    pushToast,
  } = useChordStore();
  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<ServerMember | null>(null);

  if (!serverBundle) return null;

  const { server, members, roles, myPermissions } = serverBundle;
  const canKick = hasPermission(myPermissions, PERMISSIONS.KICK_MEMBERS);
  const canBan = hasPermission(myPermissions, PERMISSIONS.BAN_MEMBERS);
  const canTimeout = hasPermission(myPermissions, PERMISSIONS.TIMEOUT_MEMBERS);
  const canManageRoles = hasPermission(myPermissions, PERMISSIONS.MANAGE_ROLES);

  const filtered = members.filter((m) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      m.user?.displayName.toLowerCase().includes(q) ||
      m.user?.username.toLowerCase().includes(q)
    );
  });

  const getPrimaryRole = (m: ServerMember) => {
    const memberRoles = roles
      .filter((r) => m.roleIds.includes(r.id) && !r.isDefault)
      .sort((a, b) => b.position - a.position);
    return memberRoles[0] || null;
  };

  const handleDirectMessage = async (targetUserId: string) => {
    try {
      const res = await apiRequest<{ thread: { id: string } }>('/api/dms', {
        method: 'POST',
        body: JSON.stringify({ participantIds: [targetUserId] }),
      });
      await refreshDms();
      setSelectedMember(null);
      await selectThread(res.thread.id);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not open DM', description: (err as Error).message });
    }
  };

  const handleToggleRole = async (member: ServerMember, roleId: string) => {
    const hasRole = member.roleIds.includes(roleId);
    const nextRoleIds = hasRole
      ? member.roleIds.filter((id) => id !== roleId)
      : [...member.roleIds, roleId];
    try {
      await apiRequest(`/api/servers/${server.id}/members/${member.userId}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ roleIds: nextRoleIds }),
      });
      await refreshServers();
      setSelectedMember((prev) => (prev ? { ...prev, roleIds: nextRoleIds } : null));
      pushToast({ type: 'success', title: 'Member roles updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Role update failed', description: (err as Error).message });
    }
  };

  const handleModeration = async (action: 'kick' | 'ban' | 'timeout', targetUserId: string) => {
    try {
      if (action === 'timeout') {
        await apiRequest(`/api/servers/${server.id}/timeout/${targetUserId}`, {
          method: 'POST',
          body: JSON.stringify({ minutes: 10 }),
        });
        pushToast({ type: 'info', title: 'Member timed out for 10 minutes' });
      } else {
        await apiRequest(`/api/servers/${server.id}/${action}/${targetUserId}`, {
          method: 'POST',
          body: JSON.stringify({ reason: `${action} by moderator` }),
        });
        pushToast({ type: 'info', title: `Member ${action === 'kick' ? 'kicked' : 'banned'}` });
        setSelectedMember(null);
      }
      await refreshServers();
    } catch (err) {
      pushToast({ type: 'error', title: 'Moderation action failed', description: (err as Error).message });
    }
  };

  const handleAddFriend = async (username: string) => {
    try {
      await apiRequest('/api/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ target: username }),
      });
      pushToast({ type: 'success', title: 'Friend request sent', description: `@${username}` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Request failed', description: (err as Error).message });
    }
  };

  return (
    <aside className="relative flex h-full w-[240px] shrink-0 flex-col border-l border-white/[0.06] bg-[#12151A]">
      <div className="p-3 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-slate-500 focus:border-[#5865F2] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1 text-xs font-medium text-slate-400">
          Members — {filtered.length}
        </div>
        {filtered.map((m) => {
          const primaryRole = getPrimaryRole(m);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedMember(m)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[#1E222B] transition-colors"
            >
              <UserAvatar user={m.user} size="sm" showStatus />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-sm font-medium truncate">
                  <span style={{ color: primaryRole?.color || '#E2E8F0' }} className="truncate">
                    {m.nickname || m.user?.displayName}
                  </span>
                  {m.user?.isBot && (
                    <span className="rounded bg-[#5865F2] px-1 py-0.5 font-mono text-[9px] font-semibold text-white">
                      BOT
                    </span>
                  )}
                  {m.user?.isNitro && !m.user?.isBot && (
                    <Crown className="h-3 w-3 shrink-0 text-amber-400" />
                  )}
                </div>
                {m.user?.badges && m.user.badges.length > 0 && (
                  <div className="mt-0.5">
                    <BadgeRow badges={m.user.badges} max={2} />
                  </div>
                )}
                {m.user?.customStatus && (
                  <div className="truncate text-[11px] text-slate-500">{m.user.customStatus}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedMember && selectedMember.user && (
        <div className="absolute right-60 top-12 z-40 w-72 rounded-xl border border-white/10 bg-[#171A21] p-4 shadow-2xl space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <UserAvatar
                user={selectedMember.user}
                size="md"
                showStatus
                onClick={() => {
                  setInspectedUser(selectedMember.user!);
                  setSelectedMember(null);
                }}
              />
              <div>
                <div className="font-display text-sm font-bold text-white flex items-center gap-1.5">
                  <span>{selectedMember.user.displayName}</span>
                  {selectedMember.user.isNitro && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                </div>
                <div className="font-mono text-xs text-slate-400">@{selectedMember.user.username}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedMember(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          {selectedMember.user.bio && (
            <p className="text-xs text-slate-300 leading-relaxed">{selectedMember.user.bio}</p>
          )}

          <button
            type="button"
            onClick={() => {
              setInspectedUser(selectedMember.user!);
              setSelectedMember(null);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
          >
            <ExternalLink className="h-3 w-3" />
            <span>Open Full Profile</span>
          </button>

          {selectedMember.userId !== user?.id && !selectedMember.user.isBot && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleDirectMessage(selectedMember.userId)}
                className="rounded-lg bg-[#5865F2] py-1.5 text-xs font-medium text-white hover:bg-[#4752C4]"
              >
                Message
              </button>
              <button
                type="button"
                onClick={() => void handleAddFriend(selectedMember.user!.username)}
                className="flex items-center justify-center gap-1 rounded-lg bg-[#262B36] py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add Friend</span>
              </button>
            </div>
          )}

          {canManageRoles && (
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Shield className="h-3.5 w-3.5" />
                <span>Roles</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {roles
                  .filter((r) => !r.isDefault)
                  .map((r) => {
                    const assigned = selectedMember.roleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void handleToggleRole(selectedMember, r.id)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                          assigned
                            ? 'border-white/25 bg-white/10 text-white'
                            : 'border-white/10 bg-transparent text-slate-400 hover:text-white'
                        }`}
                      >
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: r.color }}
                        />
                        {r.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {selectedMember.userId !== user?.id &&
            selectedMember.userId !== server.ownerId &&
            (canKick || canBan || canTimeout) && (
              <div className="pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                {canTimeout && (
                  <button
                    type="button"
                    onClick={() => void handleModeration('timeout', selectedMember.userId)}
                    className="rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25"
                  >
                    Timeout 10m
                  </button>
                )}
                {canKick && (
                  <button
                    type="button"
                    onClick={() => void handleModeration('kick', selectedMember.userId)}
                    className="rounded-md bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
                  >
                    Kick
                  </button>
                )}
                {canBan && (
                  <button
                    type="button"
                    onClick={() => void handleModeration('ban', selectedMember.userId)}
                    className="rounded-md bg-rose-600/25 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-600/40"
                  >
                    Ban
                  </button>
                )}
              </div>
            )}
        </div>
      )}
    </aside>
  );
};
