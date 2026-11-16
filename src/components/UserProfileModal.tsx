import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Ban, Calendar, Crown, MessageSquare, Shield, UserPlus, X } from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { AnimatedBanner } from './AnimatedBanner.tsx';
import { BadgeRow } from './BadgeChip.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export const UserProfileModal: React.FC = () => {
  const {
    user: currentUser,
    inspectedUser,
    serverBundle,
    friends,
    setInspectedUser,
    refreshDms,
    refreshFriends,
    selectThread,
    pushToast,
  } = useChordStore();

  const [busy, setBusy] = useState(false);

  if (!inspectedUser) return null;

  const isSelf = currentUser?.id === inspectedUser.id;
  const isFriend = friends.some((f) => f.user.id === inspectedUser.id);
  const member = serverBundle?.members.find((m) => m.userId === inspectedUser.id) || null;
  const memberRoles = member
    ? serverBundle!.roles
        .filter((r) => member.roleIds.includes(r.id) && !r.isDefault)
        .sort((a, b) => b.position - a.position)
    : [];

  const handleMessage = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ thread: { id: string } }>('/api/dms', {
        method: 'POST',
        body: JSON.stringify({ participantIds: [inspectedUser.id] }),
      });
      await refreshDms();
      setInspectedUser(null);
      await selectThread(res.thread.id);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not open DM', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleAddFriend = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ acceptedImmediately?: boolean }>('/api/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ target: inspectedUser.username }),
      });
      await refreshFriends();
      pushToast({
        type: 'success',
        title: res.acceptedImmediately ? 'Friend added' : 'Friend request sent',
        description: `@${inspectedUser.username}`,
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Request failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleBlock = async () => {
    setBusy(true);
    try {
      await apiRequest(`/api/friends/block/${inspectedUser.id}`, { method: 'POST' });
      await refreshFriends();
      pushToast({
        type: 'info',
        title: 'User blocked',
        description: `Blocked @${inspectedUser.username}`,
      });
      setInspectedUser(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Block failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const activeBanner = inspectedUser.isNitro ? inspectedUser.bannerUrl : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setInspectedUser(null)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#12151A] shadow-2xl"
      >
        {/* Profile Banner */}
        <AnimatedBanner
          bannerUrl={activeBanner}
          fallbackImage="/src/assets/images/chord_profile_banner_1794745771194.jpg"
          alt="Profile banner"
          className="h-32"
          showAnimatedLabel
        >
          <button
            type="button"
            aria-label="Close profile"
            onClick={() => setInspectedUser(null)}
            className="absolute right-3 top-3 z-20 rounded-lg bg-black/60 p-1.5 text-slate-200 hover:bg-black/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </AnimatedBanner>

        {/* Avatar + Identity */}
        <div className="px-6 pb-6">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <div className="rounded-full bg-[#12151A] p-1">
              <UserAvatar user={inspectedUser} size="xl" showStatus />
            </div>
            {!isSelf && !inspectedUser.isBot && (
              <div className="flex items-center gap-2 pb-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleMessage()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Message</span>
                </button>
                {!isFriend && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAddFriend()}
                    title="Add Friend"
                    className="rounded-lg border border-white/10 bg-[#171A21] p-2 text-slate-200 hover:bg-[#262B36]"
                  >
                    <UserPlus className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleBlock()}
                  title="Block User"
                  className="rounded-lg border border-white/10 bg-[#171A21] p-2 text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <Ban className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-xl font-bold text-white">
                  {inspectedUser.displayName}
                </h3>
                {inspectedUser.isBot && (
                  <span className="rounded bg-[#5865F2] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                    BOT
                  </span>
                )}
                {inspectedUser.isNitro && !inspectedUser.isBot && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                    <Crown className="h-3 w-3" />
                    NITRO
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-slate-400">
                @{inspectedUser.username} · #{inspectedUser.discriminator}
              </div>
              {inspectedUser.badges && inspectedUser.badges.length > 0 && (
                <div className="mt-2">
                  <BadgeRow badges={inspectedUser.badges} max={6} size="md" />
                </div>
              )}
              {(inspectedUser.customStatus || inspectedUser.activityStatus) && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-white/[0.06] bg-[#171A21] px-3 py-2 text-xs text-slate-200">
                  {inspectedUser.customStatus && <div>{inspectedUser.customStatus}</div>}
                  {inspectedUser.activityStatus && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <Activity className="h-3.5 w-3.5 shrink-0" />
                      <span>{inspectedUser.activityStatus}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {inspectedUser.bio && (
              <div className="space-y-1 border-t border-white/[0.06] pt-3">
                <div className="text-[11px] font-semibold text-slate-400">About Me</div>
                <p className="text-xs leading-relaxed text-slate-200">{inspectedUser.bio}</p>
              </div>
            )}

            {memberRoles.length > 0 && (
              <div className="space-y-2 border-t border-white/[0.06] pt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                  <Shield className="h-3 w-3" />
                  <span>Server Roles</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {memberRoles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#171A21] px-2 py-1 text-[11px] font-medium text-slate-200"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Joined {new Date(inspectedUser.createdAt).toLocaleDateString()}
              </span>
              <span className="font-mono text-slate-500">ID: {inspectedUser.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
