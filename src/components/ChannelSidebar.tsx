import React, { useState } from 'react';
import {
  Calendar,
  ChevronDown,
  Crown,
  FolderPlus,
  Hash,
  Headphones,
  HeadphoneOff,
  Lock,
  LogOut,
  Megaphone,
  MessageSquareText,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  Search,
  Settings,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import type { Channel, ChannelType, PresenceStatus } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { getChordSocket } from '../services/socket.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { playStudioCue } from '../utils/studioAudio.ts';
import { AnimatedBanner } from './AnimatedBanner.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import { translate, useLocale } from '../i18n.ts';

interface ChannelSidebarProps {
  webrtc: ReturnType<typeof import('../hooks/useWebRTC.ts').useWebRTC>;
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  onOpenInviteModal: () => void;
  onOpenCreateChannel: (categoryId?: string) => void;
  onOpenGroupDm: () => void;
}

const CHANNEL_ICON: Record<ChannelType, React.ReactNode> = {
  TEXT: <Hash className="h-4 w-4 text-slate-400 shrink-0" />,
  VOICE: <Volume2 className="h-4 w-4 text-slate-400 shrink-0" />,
  ANNOUNCEMENT: <Megaphone className="h-4 w-4 text-amber-400 shrink-0" />,
  FORUM: <MessageSquareText className="h-4 w-4 text-indigo-400 shrink-0" />,
};

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  webrtc,
  onOpenUserSettings,
  onOpenServerSettings,
  onOpenInviteModal,
  onOpenCreateChannel,
  onOpenGroupDm,
}) => {
  const locale = useLocale();
  const {
    user,
    activeSection,
    activeServerView,
    serverBundle,
    scheduledEvents,
    activeChannelId,
    directThreads,
    activeThreadId,
    voiceParticipantsByChannel,
    unreadByTarget,
    activeVoiceChannelId,
    voiceMuted,
    voiceDeafened,
    voiceCameraOn,
    voiceScreenSharing,
    voiceQuality,
    setActiveSection,
    setActiveServerView,
    selectChannel,
    selectThread,
    refreshServers,
    setAuthData,
    setQuickSwitcherOpen,
    setEditingChannel,
    pushToast,
  } = useChordStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(user?.customStatus || '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  const quickSwitcherShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';

  const canManageChannels = serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_CHANNELS)
    : false;
  const canManageServer = serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_SERVER) ||
      hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_ROLES)
    : false;

  const handleStatusChange = async (status: PresenceStatus) => {
    try {
      const res = await apiRequest<{ user: typeof user }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (res.user) setAuthData({ user: res.user });
      getChordSocket()?.emit('presence:set', { status });
    } catch (err) {
      pushToast({ type: 'error', title: 'Status update failed', description: (err as Error).message });
    }
    setStatusMenuOpen(false);
  };

  const handleSaveCustomStatus = async () => {
    try {
      const res = await apiRequest<{ user: typeof user }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ customStatus: customStatusInput }),
      });
      if (res.user) setAuthData({ user: res.user });
      getChordSocket()?.emit('presence:set', { customStatus: customStatusInput });
      pushToast({ type: 'success', title: 'Custom status updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Status update failed', description: (err as Error).message });
    }
    setStatusMenuOpen(false);
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverBundle || !newCategoryName.trim()) return;
    try {
      await apiRequest(`/api/servers/${serverBundle.server.id}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      setNewCategoryName('');
      setCreatingCat(false);
      await refreshServers();
      pushToast({ type: 'success', title: 'Category created' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not create category', description: (err as Error).message });
    }
  };

  const handleLeaveServer = async () => {
    if (!serverBundle) return;
    try {
      const leftName = serverBundle.server.name;
      await apiRequest(`/api/servers/${serverBundle.server.id}/leave`, { method: 'POST' });
      setMenuOpen(false);
      setActiveSection('home');
      await refreshServers();
      pushToast({ type: 'info', title: `Left ${leftName}` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not leave server', description: (err as Error).message });
    }
  };

  const renderChannelRow = (ch: Channel) => {
    const isActive = activeServerView === 'channel' && activeChannelId === ch.id;
    const unread = unreadByTarget[ch.id] || 0;
    const voicePeers = voiceParticipantsByChannel[ch.id] || [];
    return (
      <div key={ch.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            isActive
              ? 'bg-[#262B36] text-white font-medium'
              : unread > 0
              ? 'text-white font-medium hover:bg-[#1E222B]'
              : 'text-slate-400 hover:bg-[#1E222B] hover:text-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (ch.type === 'VOICE') {
                void selectChannel(ch.id);
                if (activeVoiceChannelId !== ch.id && serverBundle) {
                  void webrtc.joinVoiceChannel(ch.id, serverBundle.server.id);
                }
              } else {
                void selectChannel(ch.id);
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {CHANNEL_ICON[ch.type]}
            <span className="truncate">{ch.name}</span>
            {ch.isPrivate && <Lock className="h-3 w-3 shrink-0 text-slate-500" />}
          </button>

          {unread > 0 && !isActive && (
            <span className="rounded bg-[#5865F2] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}

          {canManageChannels && (
            <button
              type="button"
              title="Edit Channel Settings"
              onClick={(e) => {
                e.stopPropagation();
                setEditingChannel(ch);
              }}
              className="hidden group-hover:inline-flex rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {ch.type === 'VOICE' && voicePeers.length > 0 && (
          <div className="ml-5 mt-0.5 space-y-1 border-l border-white/10 pl-2.5 py-1">
            {voicePeers.map((vp) => (
              <div key={vp.userId} className="flex items-center gap-2 text-xs text-slate-300">
                <UserAvatar user={vp.user} size="xs" speaking={vp.speaking} />
                <span className="truncate">{vp.user?.displayName || 'Member'}</span>
                {vp.muted && <MicOff className="ml-auto h-3 w-3 text-rose-400" />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const activeVoiceChannelName =
    serverBundle?.channels.find((c) => c.id === activeVoiceChannelId)?.name || translate('voiceConnected', locale);

  return (
    <aside className="flex h-full w-[252px] shrink-0 flex-col border-r border-white/[0.06] bg-[#12151A]">
      {/* Header */}
      {activeSection === 'server' && serverBundle ? (
        <div className="relative border-b border-white/[0.06]">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-12 w-full items-center justify-between px-4 text-left hover:bg-white/[0.04] transition-colors"
          >
            <div className="min-w-0">
              <span className="block truncate font-display text-sm font-semibold text-white">
                {serverBundle.server.name}
              </span>
              <span className="block font-mono text-[10px] text-slate-400 tabular-nums">
                {serverBundle.members.length} member{serverBundle.members.length === 1 ? '' : 's'}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          {serverBundle.server.bannerUrl && (
            <AnimatedBanner
              bannerUrl={serverBundle.server.bannerUrl}
              alt={`${serverBundle.server.name} banner`}
              className="h-20 border-t border-white/[0.06]"
              showAnimatedLabel
            />
          )}

          {menuOpen && (
            <div className="absolute left-2 right-2 top-13 z-30 rounded-xl border border-white/10 bg-[#171A21] p-1.5 shadow-xl space-y-0.5 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInviteModal();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-indigo-300 hover:bg-[#5865F2] hover:text-white"
              >
                <span>{translate('invitePeople', locale)}</span>
                <UserPlus className="h-4 w-4" />
              </button>
              {canManageServer && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenServerSettings();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-slate-200 hover:bg-white/[0.06]"
                >
                  <span>Server Settings</span>
                  <Settings className="h-4 w-4" />
                </button>
              )}
              {canManageChannels && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenCreateChannel();
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-slate-200 hover:bg-white/[0.06]"
                  >
                    <span>Create Channel</span>
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setCreatingCat(true);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-slate-200 hover:bg-white/[0.06]"
                  >
                    <span>{translate('createCategory', locale)}</span>
                    <FolderPlus className="h-4 w-4" />
                  </button>
                </>
              )}
              {serverBundle.server.ownerId !== user?.id && (
                <button
                  type="button"
                  onClick={() => void handleLeaveServer()}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-rose-400 hover:bg-rose-500/15"
                >
                  <span>{translate('leaveServer', locale)}</span>
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-4">
          <span className="font-display text-sm font-semibold text-white">{translate('directMessages', locale)}</span>
          <button
            type="button"
            title="New Group DM"
            onClick={onOpenGroupDm}
            className="rounded-md p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quick Switcher Trigger */}
      <div className="px-2.5 pt-2.5">
        <button
          type="button"
          onClick={() => setQuickSwitcherOpen(true)}
          className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-[#0D0F12] px-2.5 py-1.5 text-xs text-slate-400 hover:border-white/15 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{translate('findJump', locale)}</span>
          </span>
          <kbd className="rounded border border-white/10 bg-[#171A21] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            {quickSwitcherShortcut}
          </kbd>
        </button>
      </div>

      {/* Channel / DM List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {activeSection === 'server' && serverBundle ? (
          <>
            {/* Built-in Server Workspace Features: Events (databases now live in Admin Console) */}
            <div className="space-y-1 border-b border-white/[0.06] pb-3">
              <button
                type="button"
                onClick={() => setActiveServerView('events')}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  activeServerView === 'events'
                    ? 'bg-[#262B36] text-white font-medium'
                    : 'text-slate-300 hover:bg-[#1E222B] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                  <span>{translate('events', locale)}</span>
                </span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
                  {scheduledEvents.length}
                </span>
              </button>
            </div>

            {creatingCat && (
              <form onSubmit={handleCreateCategory} className="px-1 space-y-1.5">
                <input
                  type="text"
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Category name..."
                  className="w-full rounded-md border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button type="submit" className="rounded bg-[#5865F2] px-2 py-1 text-[11px] font-medium text-white">
                    {translate('create', locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingCat(false)}
                    className="rounded bg-white/5 px-2 py-1 text-[11px] text-slate-300"
                  >
                    {translate('cancel', locale)}
                  </button>
                </div>
              </form>
            )}

            {serverBundle.categories.map((cat) => {
              const catChannels = serverBundle.channels.filter((c) => c.categoryId === cat.id);
              return (
                <div key={cat.id} className="space-y-0.5">
                  <div className="flex items-center justify-between px-2 pb-1 text-xs font-medium text-slate-400">
                    <span className="truncate">{cat.name}</span>
                    {canManageChannels && (
                      <button
                        type="button"
                        title={`Add channel to ${cat.name}`}
                        onClick={() => onOpenCreateChannel(cat.id)}
                        className="rounded p-0.5 hover:bg-white/10 hover:text-white"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {catChannels.map(renderChannelRow)}
                </div>
              );
            })}

            {serverBundle.channels
              .filter((c) => !c.categoryId || !serverBundle.categories.some((cat) => cat.id === c.categoryId))
              .map(renderChannelRow)}
          </>
        ) : (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setActiveSection('home');
                useChordStore.setState({ activeThreadId: null });
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeSection === 'home' && !activeThreadId
                  ? 'bg-[#262B36] text-white'
                  : 'text-slate-400 hover:bg-[#1E222B] hover:text-slate-200'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>{translate('friends', locale)}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('nitro')}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeSection === 'nitro'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-amber-300/80 hover:bg-[#1E222B] hover:text-amber-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Crown className="h-4 w-4" />
                <span>SNOUT NITRO</span>
              </span>
              <span className="font-mono text-[11px] text-amber-300">$2.00</span>
            </button>

            <div className="px-2 pt-4 pb-1 flex items-center justify-between text-xs font-medium text-slate-400">
              <span>{translate('directMessages', locale)}</span>
              <button
                type="button"
                onClick={onOpenGroupDm}
                className="hover:text-white"
                title="Create DM or Group DM"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {directThreads.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">
                {translate('noConversations', locale)}
              </p>
            ) : (
              directThreads.map((thread) => {
                const others = thread.participants.filter((p) => p.id !== user?.id);
                const unread = unreadByTarget[thread.id] || 0;
                const title = thread.isGroup
                  ? thread.name || others.map((o) => o.displayName).join(', ')
                  : others[0]?.displayName || 'Direct Message';
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => void selectThread(thread.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      activeThreadId === thread.id
                        ? 'bg-[#262B36] text-white font-medium'
                        : unread > 0
                        ? 'text-white font-medium hover:bg-[#1E222B]'
                        : 'text-slate-400 hover:bg-[#1E222B] hover:text-slate-200'
                    }`}
                  >
                    <UserAvatar user={others[0]} size="sm" showStatus={!thread.isGroup} />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate">{title}</div>
                      {thread.isGroup ? (
                        <div className="text-[11px] text-slate-500">{thread.participants.length} members</div>
                      ) : (
                        others[0]?.customStatus && (
                          <div className="truncate text-[11px] text-slate-500">{others[0].customStatus}</div>
                        )
                      )}
                    </div>
                    {unread > 0 && activeThreadId !== thread.id && (
                      <span className="rounded bg-[#5865F2] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Active Voice Call Dock */}
      {activeVoiceChannelId && (
        <div className="border-t border-white/[0.06] bg-[#141820] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-400">
                {translate('voiceConnected', locale)} {voiceQuality.rttMs !== null ? `· ${voiceQuality.rttMs}ms` : ''}
              </div>
              <div className="truncate text-[11px] text-slate-400">{activeVoiceChannelName}</div>
            </div>
            <button
              type="button"
              title={translate('disconnectVoice', locale)}
              onClick={webrtc.leaveVoiceChannel}
              className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/15"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void webrtc.toggleCamera()}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium ${
                voiceCameraOn ? 'bg-[#5865F2] text-white' : 'bg-[#1E222B] text-slate-300 hover:bg-[#262B36]'
              }`}
            >
              {voiceCameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
              <span>{translate('camera', locale)}</span>
            </button>
            <button
              type="button"
              onClick={() => void webrtc.toggleScreenShare()}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium ${
                voiceScreenSharing ? 'bg-emerald-600 text-white' : 'bg-[#1E222B] text-slate-300 hover:bg-[#262B36]'
              }`}
            >
              <MonitorUp className="h-3.5 w-3.5" />
              <span>Screen</span>
            </button>
          </div>
        </div>
      )}

      {/* User Control Dock */}
      <div className="relative border-t border-white/[0.06] bg-[#0F1216] p-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStatusMenuOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-white/[0.05]"
        >
          <UserAvatar user={user} size="sm" showStatus speaking={webrtc.speakingLocal} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 truncate text-xs font-semibold text-white">
              <span className="truncate">{user?.displayName}</span>
              {user?.isNitro && <Crown className="h-3 w-3 shrink-0 text-amber-400" />}
              {user?.platformRole === 'ADMIN' && (
                <span className="font-mono text-[10px] font-semibold text-rose-400 shrink-0">ADMIN</span>
              )}
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {user?.customStatus || `@${user?.username}`}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title={voiceMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            onClick={() => {
              playStudioCue(voiceMuted ? 'unmute' : 'mute');
              webrtc.toggleMute();
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              voiceMuted ? 'text-rose-400 bg-rose-500/10' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {voiceMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="button"
            title={voiceDeafened ? 'Undeafen' : 'Deafen'}
            onClick={() => {
              playStudioCue(voiceDeafened ? 'unmute' : 'mute');
              webrtc.toggleDeafen();
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              voiceDeafened ? 'text-rose-400 bg-rose-500/10' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {voiceDeafened ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
          </button>
          <button
            type="button"
            title="User Settings"
            onClick={onOpenUserSettings}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Status Popover */}
        {statusMenuOpen && (
          <div className="absolute bottom-14 left-2 right-2 z-40 rounded-xl border border-white/10 bg-[#171A21] p-2.5 shadow-2xl space-y-2 text-xs">
            <div className="font-semibold text-slate-300 px-1">Set Status</div>
            {(['online', 'idle', 'dnd', 'offline'] as PresenceStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => void handleStatusChange(st)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 capitalize text-slate-200 hover:bg-white/[0.06]"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    st === 'online'
                      ? 'bg-emerald-500'
                      : st === 'idle'
                      ? 'bg-amber-500'
                      : st === 'dnd'
                      ? 'bg-rose-500'
                      : 'bg-slate-500'
                  }`}
                />
                <span>{st === 'dnd' ? 'Do Not Disturb' : st}</span>
              </button>
            ))}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <input
                type="text"
                value={customStatusInput}
                onChange={(e) => setCustomStatusInput(e.target.value)}
                placeholder="Custom status..."
                className="w-full rounded-md border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSaveCustomStatus()}
                className="w-full rounded-md bg-[#5865F2] py-1.5 text-xs font-medium text-white hover:bg-[#4752C4]"
              >
                Save Status
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
