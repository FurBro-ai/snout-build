import { create } from 'zustand';
import type {
  BookmarkItem,
  BotApp,
  Channel,
  DirectThread,
  FriendRelation,
  FriendRequestRecord,
  Message,
  NotificationItem,
  PresenceStatus,
  PublicUser,
  Role,
  ScheduledEvent,
  Server,
  ServerCategory,
  ServerDatabaseRow,
  ServerDatabaseTable,
  ServerMember,
  SubscriptionRecord,
  VoiceParticipant,
} from '../../shared/types.ts';
import { apiRequest, getStoredToken, setStoredToken } from '../services/api.ts';
import { connectChordSocket, disconnectChordSocket, getChordSocket } from '../services/socket.ts';

export type ActiveSection = 'home' | 'server' | 'nitro' | 'developer' | 'admin' | 'community' | 'docs' | 'support';
export type ActiveServerView = 'channel' | 'databases' | 'events';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

export interface ServerBundle {
  server: Server;
  categories: ServerCategory[];
  channels: Channel[];
  roles: Role[];
  members: ServerMember[];
  myPermissions: number;
}

interface ChordStore {
  user: PublicUser | null;
  email: string | null;
  subscription: SubscriptionRecord | null;
  authChecked: boolean;

  activeSection: ActiveSection;
  activeServerView: ActiveServerView;
  activeServerId: string | null;
  activeChannelId: string | null;
  activeThreadId: string | null;
  showMemberList: boolean;

  servers: Server[];
  serverBundle: ServerBundle | null;
  serverBots: BotApp[];
  serverDatabases: ServerDatabaseTable[];
  serverDatabaseRows: ServerDatabaseRow[];
  scheduledEvents: ScheduledEvent[];
  bookmarks: BookmarkItem[];
  directThreads: DirectThread[];
  friends: FriendRelation[];
  incomingRequests: FriendRequestRecord[];
  outgoingRequests: FriendRequestRecord[];
  blockedUsers: FriendRelation[];
  notifications: NotificationItem[];

  messagesByTarget: Record<string, Message[]>;
  typingByTarget: Record<string, Array<{ userId: string; displayName: string }>>;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  unreadByTarget: Record<string, number>;

  toasts: ToastItem[];
  inspectedUser: PublicUser | null;
  quickSwitcherOpen: boolean;
  editingChannel: Channel | null;

  activeVoiceChannelId: string | null;
  activeVoiceServerId: string | null;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  voiceCameraOn: boolean;
  voiceScreenSharing: boolean;
  voicePushToTalk: boolean;
  voiceQuality: { rttMs: number | null; state: string };

  setAuthData: (payload: { token?: string; user: PublicUser; email?: string; subscription?: SubscriptionRecord | null; rememberMe?: boolean }) => void;
  bootstrapSession: () => Promise<void>;
  logout: () => Promise<void>;
  setActiveSection: (section: ActiveSection) => void;
  setActiveServerView: (view: ActiveServerView) => void;
  toggleMemberList: () => void;

  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
  setInspectedUser: (user: PublicUser | null) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setEditingChannel: (channel: Channel | null) => void;
  clearUnread: (targetId: string) => void;

  refreshAllData: () => Promise<void>;
  refreshFriends: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshDms: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshBookmarks: () => Promise<void>;
  refreshServerDatabases: (serverId: string) => Promise<void>;
  refreshScheduledEvents: (serverId: string) => Promise<void>;

  selectServer: (serverId: string, preferredChannelId?: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  loadMessages: (targetType: 'channel' | 'thread', targetId: string, query?: string) => Promise<void>;
  upsertMessage: (targetId: string, msg: Message) => void;
  removeMessage: (targetId: string, messageId: string) => void;

  setVoiceSession: (channelId: string | null, serverId: string | null) => void;
  setVoiceFlags: (patch: Partial<Pick<ChordStore, 'voiceMuted' | 'voiceDeafened' | 'voiceCameraOn' | 'voiceScreenSharing' | 'voicePushToTalk' | 'voiceQuality'>>) => void;

  bindSocketEvents: () => void;
}

let socketBound = false;

export const useChordStore = create<ChordStore>((set, get) => ({
  user: null,
  email: null,
  subscription: null,
  authChecked: false,

  activeSection: 'home',
  activeServerView: 'channel',
  activeServerId: null,
  activeChannelId: null,
  activeThreadId: null,
  showMemberList: true,

  servers: [],
  serverBundle: null,
  serverBots: [],
  serverDatabases: [],
  serverDatabaseRows: [],
  scheduledEvents: [],
  bookmarks: [],
  directThreads: [],
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  blockedUsers: [],
  notifications: [],

  messagesByTarget: {},
  typingByTarget: {},
  voiceParticipantsByChannel: {},
  unreadByTarget: {},

  toasts: [],
  inspectedUser: null,
  quickSwitcherOpen: false,
  editingChannel: null,

  activeVoiceChannelId: null,
  activeVoiceServerId: null,
  voiceMuted: false,
  voiceDeafened: false,
  voiceCameraOn: false,
  voiceScreenSharing: false,
  voicePushToTalk: false,
  voiceQuality: { rttMs: null, state: 'idle' },

  pushToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 4200);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setInspectedUser: (inspectedUser) => set({ inspectedUser }),
  setQuickSwitcherOpen: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
  setEditingChannel: (editingChannel) => set({ editingChannel }),
  clearUnread: (targetId) =>
    set((s) => {
      if (!s.unreadByTarget[targetId]) return s;
      const next = { ...s.unreadByTarget };
      delete next[targetId];
      return { unreadByTarget: next };
    }),

  setAuthData: ({ token, user, email, subscription, rememberMe = true }) => {
    if (token) setStoredToken(token, rememberMe);
    set((s) => ({
      user,
      email: email ?? s.email,
      subscription: subscription !== undefined ? subscription : s.subscription,
      authChecked: true,
    }));
    get().bindSocketEvents();
  },

  bootstrapSession: async () => {
    const token = getStoredToken();
    if (!token) {
      set({ authChecked: true, user: null });
      return;
    }
    try {
      const data = await apiRequest<{ user: PublicUser; email: string; subscription: SubscriptionRecord | null }>(
        '/api/auth/me'
      );
      set({
        user: data.user,
        email: data.email,
        subscription: data.subscription,
        authChecked: true,
      });
      get().bindSocketEvents();
      await get().refreshAllData();
    } catch {
      setStoredToken(null);
      set({ user: null, email: null, subscription: null, authChecked: true });
    }
  },

  logout: async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    disconnectChordSocket();
    socketBound = false;
    setStoredToken(null);
    set({
      user: null,
      email: null,
      subscription: null,
      servers: [],
      serverBundle: null,
      serverBots: [],
      serverDatabases: [],
      serverDatabaseRows: [],
      scheduledEvents: [],
      bookmarks: [],
      directThreads: [],
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      blockedUsers: [],
      messagesByTarget: {},
      unreadByTarget: {},
      inspectedUser: null,
      quickSwitcherOpen: false,
      editingChannel: null,
      activeServerId: null,
      activeChannelId: null,
      activeThreadId: null,
      activeVoiceChannelId: null,
      activeSection: 'home',
      activeServerView: 'channel',
    });
  },

  setActiveSection: (activeSection) => set({ activeSection }),
  setActiveServerView: (activeServerView) => set({ activeServerView }),
  toggleMemberList: () => set((s) => ({ showMemberList: !s.showMemberList })),

  refreshAllData: async () => {
    await Promise.all([
      get().refreshServers(),
      get().refreshFriends(),
      get().refreshDms(),
      get().refreshNotifications(),
      get().refreshBookmarks(),
    ]);
    try {
      const vp = await apiRequest<{ participants: VoiceParticipant[] }>('/api/voice/participants');
      const grouped: Record<string, VoiceParticipant[]> = {};
      for (const p of vp.participants) {
        if (!grouped[p.channelId]) grouped[p.channelId] = [];
        grouped[p.channelId].push(p);
      }
      set({ voiceParticipantsByChannel: grouped });
    } catch {
      // ignore
    }
  },

  refreshServers: async () => {
    const res = await apiRequest<{ servers: Server[] }>('/api/servers');
    set({ servers: res.servers });
    const activeId = get().activeServerId;
    if (activeId && res.servers.some((s) => s.id === activeId)) {
      const [bundle, botsRes] = await Promise.all([
        apiRequest<ServerBundle>(`/api/servers/${activeId}`),
        apiRequest<{ bots: BotApp[] }>(`/api/bots/server/${activeId}`).catch(() => ({ bots: [] })),
      ]);
      const currentChanId = get().activeChannelId;
      const channelStillExists = currentChanId && bundle.channels.some((c) => c.id === currentChanId);
      set({
        serverBundle: bundle,
        serverBots: botsRes.bots,
        activeChannelId: channelStillExists ? currentChanId : bundle.channels[0]?.id ?? null,
      });
    } else if (activeId) {
      set({ serverBundle: null, serverBots: [], activeServerId: null, activeChannelId: null });
    }
  },

  refreshFriends: async () => {
    const res = await apiRequest<{
      friends: FriendRelation[];
      incomingRequests: FriendRequestRecord[];
      outgoingRequests: FriendRequestRecord[];
      blocked: FriendRelation[];
    }>('/api/friends');
    set({
      friends: res.friends,
      incomingRequests: res.incomingRequests,
      outgoingRequests: res.outgoingRequests,
      blockedUsers: res.blocked,
    });
  },

  refreshDms: async () => {
    const res = await apiRequest<{ threads: DirectThread[] }>('/api/dms');
    set({ directThreads: res.threads });
  },

  refreshNotifications: async () => {
    const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
    set({ notifications: res.notifications });
  },

  refreshBookmarks: async () => {
    const res = await apiRequest<{ bookmarks: BookmarkItem[] }>('/api/bookmarks').catch(() => ({
      bookmarks: [],
    }));
    set({ bookmarks: res.bookmarks });
  },

  refreshServerDatabases: async (serverId) => {
    const res = await apiRequest<{ tables: ServerDatabaseTable[]; rows: ServerDatabaseRow[] }>(
      `/api/servers/${serverId}/databases`
    ).catch(() => ({ tables: [], rows: [] }));
    set({ serverDatabases: res.tables, serverDatabaseRows: res.rows });
  },

  refreshScheduledEvents: async (serverId) => {
    const res = await apiRequest<{ events: ScheduledEvent[] }>(
      `/api/servers/${serverId}/events`
    ).catch(() => ({ events: [] }));
    set({ scheduledEvents: res.events });
  },

  selectServer: async (serverId, preferredChannelId) => {
    const [bundle, botsRes, dbRes, evtRes] = await Promise.all([
      apiRequest<ServerBundle>(`/api/servers/${serverId}`),
      apiRequest<{ bots: BotApp[] }>(`/api/bots/server/${serverId}`).catch(() => ({ bots: [] })),
      apiRequest<{ tables: ServerDatabaseTable[]; rows: ServerDatabaseRow[] }>(
        `/api/servers/${serverId}/databases`
      ).catch(() => ({ tables: [], rows: [] })),
      apiRequest<{ events: ScheduledEvent[] }>(
        `/api/servers/${serverId}/events`
      ).catch(() => ({ events: [] })),
    ]);
    const preferred = preferredChannelId
      ? bundle.channels.find((c) => c.id === preferredChannelId) || null
      : null;
    const targetChannel =
      preferred ||
      bundle.channels.find((c) => c.type === 'TEXT' || c.type === 'ANNOUNCEMENT') ||
      bundle.channels[0] ||
      null;

    set((s) => {
      const nextUnread = { ...s.unreadByTarget };
      if (targetChannel) delete nextUnread[targetChannel.id];
      return {
        activeSection: 'server',
        activeServerView: 'channel',
        activeServerId: serverId,
        activeThreadId: null,
        serverBundle: bundle,
        serverBots: botsRes.bots,
        serverDatabases: dbRes.tables,
        serverDatabaseRows: dbRes.rows,
        scheduledEvents: evtRes.events,
        activeChannelId: targetChannel ? targetChannel.id : null,
        unreadByTarget: nextUnread,
      };
    });

    const sock = getChordSocket();
    sock?.emit('room:join', { serverId, channelId: targetChannel?.id });

    if (targetChannel && targetChannel.type !== 'VOICE') {
      await get().loadMessages('channel', targetChannel.id);
    }
  },

  selectChannel: async (channelId) => {
    get().clearUnread(channelId);
    set({
      activeSection: 'server',
      activeServerView: 'channel',
      activeChannelId: channelId,
      activeThreadId: null,
    });
    getChordSocket()?.emit('room:join', { channelId });
    await get().loadMessages('channel', channelId);
  },

  selectThread: async (threadId) => {
    get().clearUnread(threadId);
    set({ activeSection: 'home', activeThreadId: threadId, activeChannelId: null });
    getChordSocket()?.emit('room:join', { threadId });
    await get().loadMessages('thread', threadId);
  },

  loadMessages: async (targetType, targetId, query) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const url =
      targetType === 'channel'
        ? `/api/channels/${targetId}/messages${qs}`
        : `/api/dms/${targetId}/messages${qs}`;
    const res = await apiRequest<{ messages: Message[] }>(url);
    set((s) => ({
      messagesByTarget: {
        ...s.messagesByTarget,
        [targetId]: res.messages,
      },
    }));
  },

  upsertMessage: (targetId, msg) => {
    set((s) => {
      const list = s.messagesByTarget[targetId] || [];
      const idx = list.findIndex((m) => m.id === msg.id);
      const next = idx >= 0 ? list.map((m) => (m.id === msg.id ? msg : m)) : [...list, msg];
      return {
        messagesByTarget: {
          ...s.messagesByTarget,
          [targetId]: next,
        },
      };
    });
  },

  removeMessage: (targetId, messageId) => {
    set((s) => {
      const list = s.messagesByTarget[targetId] || [];
      return {
        messagesByTarget: {
          ...s.messagesByTarget,
          [targetId]: list.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  setVoiceSession: (channelId, serverId) =>
    set({
      activeVoiceChannelId: channelId,
      activeVoiceServerId: serverId,
      voiceQuality: channelId ? { rttMs: null, state: 'connecting' } : { rttMs: null, state: 'idle' },
    }),

  setVoiceFlags: (patch) => set((s) => ({ ...s, ...patch })),

  bindSocketEvents: () => {
    const socket = connectChordSocket();
    if (!socket || socketBound) return;
    socketBound = true;

    socket.on('connect', () => {
      const state = get();
      if (state.activeServerId || state.activeChannelId || state.activeThreadId) {
        socket.emit('room:join', {
          serverId: state.activeServerId || undefined,
          channelId: state.activeChannelId || undefined,
          threadId: state.activeThreadId || undefined,
        });
      }
    });

    socket.on('server:updated', (payload: { serverId: string }) => {
      if (payload.serverId === get().activeServerId || get().servers.some((s) => s.id === payload.serverId)) {
        void get().refreshServers().then(() => {
          const chId = get().activeChannelId;
          if (chId) {
            socket.emit('room:join', { serverId: payload.serverId, channelId: chId });
          }
        });
      }
    });

    socket.on('serverdb:updated', (payload: { serverId: string }) => {
      if (payload.serverId === get().activeServerId) {
        void get().refreshServerDatabases(payload.serverId);
      }
    });

    socket.on('events:updated', (payload: { serverId: string }) => {
      if (payload.serverId === get().activeServerId) {
        void get().refreshScheduledEvents(payload.serverId);
      }
    });

    socket.on('message:new', (msg: Message) => {
      const targetId = msg.channelId || msg.threadId;
      if (!targetId) return;
      get().upsertMessage(targetId, msg);

      const state = get();
      const isViewingTarget =
        (state.activeSection === 'server' && state.activeChannelId === targetId) ||
        (state.activeSection === 'home' && state.activeThreadId === targetId);
      if (!isViewingTarget && msg.authorId !== state.user?.id) {
        set((s) => ({
          unreadByTarget: {
            ...s.unreadByTarget,
            [targetId]: (s.unreadByTarget[targetId] || 0) + 1,
          },
        }));
      }
    });

    socket.on('message:dm-notify', (msg: Message) => {
      const state = get();
      if (msg.threadId && !(state.activeSection === 'home' && state.activeThreadId === msg.threadId)) {
        set((s) => ({
          unreadByTarget: {
            ...s.unreadByTarget,
            [msg.threadId!]: (s.unreadByTarget[msg.threadId!] || 0) + 1,
          },
        }));
        if (msg.authorId !== state.user?.id) {
          state.pushToast({
            type: 'info',
            title: msg.author?.displayName || 'Direct Message',
            description: msg.content.slice(0, 80) || 'Sent an attachment',
          });
        }
      }
    });

    socket.on('message:update', (msg: Message) => {
      const targetId = msg.channelId || msg.threadId;
      if (targetId) get().upsertMessage(targetId, msg);
    });

    socket.on('message:delete', (payload: { messageId: string; channelId?: string; threadId?: string }) => {
      const targetId = payload.channelId || payload.threadId;
      if (targetId) get().removeMessage(targetId, payload.messageId);
    });

    socket.on('dm:thread', (thread: DirectThread) => {
      set((s) => {
        if (s.directThreads.some((t) => t.id === thread.id)) return s;
        return { directThreads: [thread, ...s.directThreads] };
      });
      socket.emit('room:join', { threadId: thread.id });
    });

    socket.on('typing:update', (payload: { userId: string; displayName: string; channelId?: string; threadId?: string; isTyping: boolean }) => {
      const targetId = payload.channelId || payload.threadId;
      if (!targetId || payload.userId === get().user?.id) return;
      set((s) => {
        const current = s.typingByTarget[targetId] || [];
        const filtered = current.filter((u) => u.userId !== payload.userId);
        const next = payload.isTyping ? [...filtered, { userId: payload.userId, displayName: payload.displayName }] : filtered;
        return { typingByTarget: { ...s.typingByTarget, [targetId]: next } };
      });
    });

    socket.on('presence:update', (payload: { userId: string; status: PresenceStatus; customStatus: string; activityStatus: string }) => {
      set((s) => {
        const updateUser = (u: PublicUser) =>
          u.id === payload.userId
            ? { ...u, status: payload.status, customStatus: payload.customStatus, activityStatus: payload.activityStatus }
            : u;
        return {
          user: s.user ? updateUser(s.user) : null,
          friends: s.friends.map((f) => ({ ...f, user: updateUser(f.user) })),
          directThreads: s.directThreads.map((t) => ({
            ...t,
            participants: t.participants.map(updateUser),
          })),
          inspectedUser: s.inspectedUser ? updateUser(s.inspectedUser) : null,
          serverBundle: s.serverBundle
            ? {
                ...s.serverBundle,
                members: s.serverBundle.members.map((m) =>
                  m.user ? { ...m, user: updateUser(m.user) } : m
                ),
              }
            : null,
        };
      });
    });

    socket.on('user:updated', (payload: { user: PublicUser }) => {
      const updated = payload.user;
      set((s) => {
        const swap = (u: PublicUser) => (u.id === updated.id ? { ...u, ...updated } : u);
        return {
          user: s.user?.id === updated.id ? { ...s.user, ...updated } : s.user,
          friends: s.friends.map((f) => ({ ...f, user: swap(f.user) })),
          directThreads: s.directThreads.map((t) => ({
            ...t,
            participants: t.participants.map(swap),
          })),
          inspectedUser: s.inspectedUser?.id === updated.id ? { ...s.inspectedUser, ...updated } : s.inspectedUser,
          serverBundle: s.serverBundle
            ? {
                ...s.serverBundle,
                members: s.serverBundle.members.map((m) =>
                  m.user ? { ...m, user: swap(m.user) } : m
                ),
              }
            : null,
        };
      });
    });

    socket.on('voice:participants', (payload: { channelId: string; participants: VoiceParticipant[] }) => {
      set((s) => ({
        voiceParticipantsByChannel: {
          ...s.voiceParticipantsByChannel,
          [payload.channelId]: payload.participants,
        },
      }));
    });

    socket.on('notification:new', (notif: NotificationItem) => {
      set((s) => ({ notifications: [notif, ...s.notifications] }));
      get().pushToast({
        type: 'info',
        title: notif.title,
        description: notif.body,
      });
    });

    socket.on('nitro:updated', (payload: { isNitro: boolean; subscription: SubscriptionRecord | null }) => {
      set((s) => ({
        user: s.user ? { ...s.user, isNitro: payload.isNitro } : null,
        subscription: payload.subscription,
      }));
      if (payload.isNitro) {
        get().pushToast({
          type: 'success',
          title: 'SNOUT NITRO Activated',
          description: 'Your monthly $2.00/mo Nitro perks are now active.',
        });
      }
    });

    socket.on('session:revoked', (payload?: { reason?: string }) => {
      get().pushToast({
        type: 'error',
        title: 'Session Ended',
        description: payload?.reason || 'Your session was terminated by an administrator.',
      });
      void get().logout();
    });
  },
}));
