import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ALL_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  MODERATOR_PERMISSIONS,
} from '../../../shared/constants.ts';
import type {
  AdminBadge,
  AuditLogEntry,
  BookmarkItem,
  BotApp,
  BotLog,
  Channel,
  ChannelWebhook,
  CommunityIdea,
  DirectThread,
  FriendRequestRecord,
  Message,
  NotificationItem,
  PaymentRecord,
  PlatformRole,
  PresenceStatus,
  PublicUser,
  Role,
  ScheduledEvent,
  Server,
  ServerBan,
  ServerCategory,
  ServerDatabaseRow,
  ServerDatabaseTable,
  ServerInvite,
  ServerMember,
  SubscriptionRecord,
  SupportTicket,
  UserSession,
  VoiceServerNode,
} from '../../../shared/types.ts';
import { loadStateFromSqlite, syncStateToSqlite } from './sqliteEngine.ts';
import { createDefaultVoiceServers } from '../voice/defaultVoiceServers.ts';

export interface StoredUser {
  id: string;
  firebaseUid: string | null;
  username: string;
  discriminator: string;
  displayName: string;
  email: string;
  passwordHash: string | null;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  passwordResetToken: string | null;
  passwordResetExpiresAt: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  twoFactorPendingSecret?: string | null;
  twoFactorBackupHashes?: string[];
  avatarUrl: string | null;
  animatedAvatarUrl: string | null;
  bannerUrl: string | null;
  bio: string;
  status: PresenceStatus;
  customStatus: string;
  activityStatus: string;
  profileDecoration: string;
  isNitro: boolean;
  isBot: boolean;
  isSuspended: boolean;
  platformRole: PlatformRole;
  badgeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredBot extends BotApp {
  tokenHash: string;
  clientSecretHash: string;
}

export interface StoredFriend {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: string;
}

export interface StoredBlock {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

export interface DatabaseState {
  users: StoredUser[];
  sessions: Array<UserSession & { tokenHash: string }>;
  friends: StoredFriend[];
  friendRequests: FriendRequestRecord[];
  blocks: StoredBlock[];
  directThreads: DirectThread[];
  servers: Server[];
  categories: ServerCategory[];
  channels: Channel[];
  roles: Role[];
  members: ServerMember[];
  invites: ServerInvite[];
  bans: ServerBan[];
  messages: Message[];
  bots: StoredBot[];
  channelWebhooks: ChannelWebhook[];
  botLogs: BotLog[];
  notifications: NotificationItem[];
  payments: PaymentRecord[];
  subscriptions: SubscriptionRecord[];
  auditLogs: AuditLogEntry[];
  serverDatabases: ServerDatabaseTable[];
  serverDatabaseRows: ServerDatabaseRow[];
  bookmarks: BookmarkItem[];
  scheduledEvents: ScheduledEvent[];
  badges: AdminBadge[];
  communityIdeas: CommunityIdea[];
  supportTickets: SupportTicket[];
  voiceServers: VoiceServerNode[];
  platformConfig: {
    maintenanceMode: boolean;
    registrationEnabled: boolean;
    nitroPriceUsd: number;
    platega: {
      merchantId: string;
      secret: string;
      webhookSecret: string;
      apiUrl: string;
      sandboxMode: boolean;
      updatedAt: string | null;
      updatedBy: string | null;
    };
  };
}

const DATA_DIR = process.env.SNOUT_DATA_DIR
  ? path.resolve(process.env.SNOUT_DATA_DIR)
  : process.env.VERCEL
    ? path.join('/tmp', 'snout-data')
    : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'chord-db.json');

export const DEFAULT_BADGES: AdminBadge[] = [
  {
    id: 'badge-founder',
    label: 'Founder',
    description: 'Built the Snout platform from the ground up.',
    color: '#F59E0B',
    icon: '👑',
    priority: 100,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-staff',
    label: 'Platform Staff',
    description: 'Official member of the Snout platform team.',
    color: '#5865F2',
    icon: '🛡️',
    priority: 90,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-nitro',
    label: 'Nitro',
    description: 'Active SNOUT NITRO subscriber.',
    color: '#FBBF24',
    icon: '💎',
    priority: 70,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-developer',
    label: 'Verified Developer',
    description: 'Published a reviewed bot on the Snout Developer Portal.',
    color: '#22D3EE',
    icon: '🤖',
    priority: 60,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-bug-hunter',
    label: 'Bug Hunter',
    description: 'Reported a confirmed platform vulnerability or defect.',
    color: '#F43F5E',
    icon: '🐛',
    priority: 50,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-early-adopter',
    label: 'Early Adopter',
    description: 'Joined during the Snout community launch window.',
    color: '#34D399',
    icon: '🌱',
    priority: 40,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-support-hero',
    label: 'Support Hero',
    description: 'Went above and beyond helping other members.',
    color: '#A78BFA',
    icon: '💜',
    priority: 45,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'badge-verified',
    label: 'Verified',
    description: 'Identity verified by the Snout trust & safety team.',
    color: '#38BDF8',
    icon: '✅',
    priority: 80,
    isSystem: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

export const EMPTY_PLATEGA_CONFIG = {
  merchantId: '',
  secret: '',
  webhookSecret: '',
  apiUrl: '',
  sandboxMode: false,
  updatedAt: null as string | null,
  updatedBy: null as string | null,
};

function createInitialState(): DatabaseState {
  const now = new Date().toISOString();
  const sentinelBotUserId = 'bot-user-chord-sentinel';
  const sentinelBotId = 'bot-app-chord-sentinel';
  const hubServerId = 'server-chord-hub';

  const sentinelBotUser: StoredUser = {
    id: sentinelBotUserId,
    firebaseUid: null,
    username: 'snout_sentinel',
    discriminator: '0000',
    displayName: 'Snout Sentinel',
    email: 'sentinel@bot.snout.internal',
    passwordHash: null,
    emailVerified: true,
    emailVerificationToken: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    avatarUrl: '/src/assets/images/chord_avatar_bot_1794745770795.jpg',
    animatedAvatarUrl: null,
    bannerUrl: 'preset:soundwave_horizon',
    bio: 'Official Snout platform utility & slash command bot.',
    status: 'online',
    customStatus: 'Use /help in any channel',
    activityStatus: 'Listening for /commands',
    profileDecoration: 'chromatic_spin',
    isNitro: true,
    isBot: true,
    isSuspended: false,
    platformRole: 'USER',
    badgeIds: ['badge-staff', 'badge-developer'],
    createdAt: now,
    updatedAt: now,
  };

  const sentinelBot: StoredBot = {
    id: sentinelBotId,
    ownerId: sentinelBotUserId,
    botUserId: sentinelBotUserId,
    name: 'Snout Sentinel',
    description: 'Official built-in utility bot supporting /help, /ping, /serverinfo, and /poll slash commands.',
    avatarUrl: '/src/assets/images/chord_avatar_bot_1794745770795.jpg',
    tokenPrefix: 'snout_bot_sentinel',
    tokenHash: crypto.createHash('sha256').update('sentinel-internal').digest('hex'),
    clientSecretHash: crypto.createHash('sha256').update('sentinel-secret').digest('hex'),
    permissions: DEFAULT_MEMBER_PERMISSIONS,
    webhookUrl: null,
    subscribedEvents: ['MESSAGE_CREATE', 'SLASH_COMMAND'],
    slashCommands: [
      { id: 'cmd-help', botId: sentinelBotId, name: 'help', description: 'List available Snout Sentinel slash commands', options: [] },
      { id: 'cmd-ping', botId: sentinelBotId, name: 'ping', description: 'Verify live WebSocket & bot gateway responsiveness', options: [] },
      { id: 'cmd-serverinfo', botId: sentinelBotId, name: 'serverinfo', description: 'Display member count, roles, and channels for this server', options: [] },
      { id: 'cmd-poll', botId: sentinelBotId, name: 'poll', description: 'Create a quick reaction poll in the channel', options: [{ name: 'question', description: 'Poll prompt', required: true }] },
    ],
    installedServerIds: [hubServerId],
    createdAt: now,
  };

  const hubServer: Server = {
    id: hubServerId,
    name: 'Snout Community Hub',
    description: 'Official community workspace for real-time messaging, voice lounges, forums, and slash commands.',
    iconUrl: '/snout-icon.svg',
    bannerUrl: 'preset:aurora_drift',
    ownerId: sentinelBotUserId,
    isPublic: true,
    boostTier: 1,
    createdAt: now,
  };

  const catTextId = 'cat-hub-text';
  const catVoiceId = 'cat-hub-voice';

  const defaultRoleId = 'role-hub-everyone';
  const modRoleId = 'role-hub-mod';
  const adminRoleId = 'role-hub-admin';

  return {
    users: [sentinelBotUser],
    sessions: [],
    friends: [],
    friendRequests: [],
    blocks: [],
    directThreads: [],
    servers: [hubServer],
    categories: [
      { id: catTextId, serverId: hubServerId, name: 'Channels', position: 0 },
      { id: catVoiceId, serverId: hubServerId, name: 'Voice & Stage', position: 1 },
    ],
    channels: [
      {
        id: 'chan-hub-welcome',
        serverId: hubServerId,
        categoryId: catTextId,
        name: 'welcome',
        topic: 'Welcome to Snout — create your own server or invite friends.',
        type: 'ANNOUNCEMENT',
        isPrivate: false,
        position: 0,
        bitrate: 64000,
        overrides: [],
        createdAt: now,
      },
      {
        id: 'chan-hub-general',
        serverId: hubServerId,
        categoryId: catTextId,
        name: 'general',
        topic: 'Real-time multi-user chat, Markdown, code blocks, files, and /slash commands.',
        type: 'TEXT',
        isPrivate: false,
        position: 1,
        bitrate: 64000,
        overrides: [],
        createdAt: now,
      },
      {
        id: 'chan-hub-forum',
        serverId: hubServerId,
        categoryId: catTextId,
        name: 'ideas-forum',
        topic: 'Threaded discussions and community topics.',
        type: 'FORUM',
        isPrivate: false,
        position: 2,
        bitrate: 64000,
        overrides: [],
        createdAt: now,
      },
      {
        id: 'chan-hub-voice',
        serverId: hubServerId,
        categoryId: catVoiceId,
        name: 'Voice Lounge',
        topic: 'WebRTC voice, camera video, and screen sharing.',
        type: 'VOICE',
        isPrivate: false,
        position: 3,
        bitrate: 96000,
        overrides: [],
        createdAt: now,
      },
    ],
    roles: [
      {
        id: defaultRoleId,
        serverId: hubServerId,
        name: '@everyone',
        color: '#94A3B8',
        position: 0,
        permissions: DEFAULT_MEMBER_PERMISSIONS,
        isDefault: true,
        hoist: false,
      },
      {
        id: modRoleId,
        serverId: hubServerId,
        name: 'Moderator',
        color: '#34D399',
        position: 1,
        permissions: MODERATOR_PERMISSIONS,
        isDefault: false,
        hoist: true,
      },
      {
        id: adminRoleId,
        serverId: hubServerId,
        name: 'Administrator',
        color: '#5865F2',
        position: 2,
        permissions: ALL_PERMISSIONS,
        isDefault: false,
        hoist: true,
      },
    ],
    members: [
      {
        id: 'member-sentinel-hub',
        serverId: hubServerId,
        userId: sentinelBotUserId,
        nickname: 'Snout Sentinel',
        roleIds: [defaultRoleId],
        joinedAt: now,
        timeoutUntil: null,
      },
    ],
    invites: [
      {
        code: 'SNOUTHUB',
        serverId: hubServerId,
        creatorId: sentinelBotUserId,
        maxUses: null,
        uses: 0,
        expiresAt: null,
        createdAt: now,
      },
    ],
    bans: [],
    messages: [
      {
        id: 'msg-hub-welcome-1',
        channelId: 'chan-hub-welcome',
        threadId: null,
        serverId: hubServerId,
        authorId: sentinelBotUserId,
        content:
          '**Welcome to Snout.**\n\nAll messages, voice channels, friend requests, bots, and **SNOUT NITRO ($2.00 / month)** subscriptions run on live backend APIs and Socket.IO.\n\nTry `/help` in `#general` or create your own server from the left rail.',
        replyToId: null,
        attachments: [],
        reactions: [],
        mentions: [],
        linkPreview: null,
        isPinned: true,
        isEdited: false,
        readByIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    bots: [sentinelBot],
    channelWebhooks: [],
    botLogs: [],
    notifications: [],
    payments: [],
    subscriptions: [],
    auditLogs: [],
    serverDatabases: [
      {
        id: 'srvdb-hub-roadmap',
        serverId: hubServerId,
        name: 'Community Roadmap',
        description: 'Live built-in SQLite table tracking features, voice upgrades, and moderation tools.',
        icon: 'rocket',
        columns: [
          { id: 'col_title', name: 'Initiative', type: 'text' },
          { id: 'col_status', name: 'Status', type: 'status', options: ['Planned', 'In Progress', 'Shipped'] },
          { id: 'col_votes', name: 'Priority Score', type: 'number' },
          { id: 'col_public', name: 'Public', type: 'checkbox' },
          { id: 'col_target', name: 'Target Date', type: 'date' },
        ],
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'srvdb-hub-resources',
        serverId: hubServerId,
        name: 'Platform Endpoints & Guides',
        description: 'Structured directory for Snout workspace capabilities, WebRTC voice, and Bot API.',
        icon: 'database',
        columns: [
          { id: 'col_name', name: 'Feature', type: 'text' },
          { id: 'col_area', name: 'Category', type: 'status', options: ['Voice & Video', 'Security', 'Bots', 'Billing'] },
          { id: 'col_enabled', name: 'Live', type: 'checkbox' },
          { id: 'col_notes', name: 'Details', type: 'text' },
        ],
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    serverDatabaseRows: [
      {
        id: 'srvrow-1',
        tableId: 'srvdb-hub-roadmap',
        serverId: hubServerId,
        cells: {
          col_title: 'Built-in SQLite Database Engine + Server Tables',
          col_status: 'Shipped',
          col_votes: 100,
          col_public: true,
          col_target: now.slice(0, 10),
        },
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'srvrow-2',
        tableId: 'srvdb-hub-roadmap',
        serverId: hubServerId,
        cells: {
          col_title: 'Two-Factor Authentication with QR & Backup Codes',
          col_status: 'Shipped',
          col_votes: 98,
          col_public: true,
          col_target: now.slice(0, 10),
        },
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'srvrow-3',
        tableId: 'srvdb-hub-roadmap',
        serverId: hubServerId,
        cells: {
          col_title: 'Scheduled Voice Stage Townhall Events',
          col_status: 'In Progress',
          col_votes: 85,
          col_public: true,
          col_target: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        },
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'srvrow-4',
        tableId: 'srvdb-hub-resources',
        serverId: hubServerId,
        cells: {
          col_name: 'WebRTC Spatial Voice & Screen Share',
          col_area: 'Voice & Video',
          col_enabled: true,
          col_notes: 'Mesh audio/video signaling over Socket.IO with mute, deafen & camera toggles',
        },
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'srvrow-5',
        tableId: 'srvdb-hub-resources',
        serverId: hubServerId,
        cells: {
          col_name: 'SNOUT NITRO Platega Billing ($2.00/mo)',
          col_area: 'Billing',
          col_enabled: true,
          col_notes: 'Animated banners, chromatic decorations, custom bot tools, 100MB uploads',
        },
        createdBy: sentinelBotUserId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    bookmarks: [],
    scheduledEvents: [
      {
        id: 'evt-hub-townhall',
        serverId: hubServerId,
        channelId: 'chan-hub-voice',
        title: 'Snout Community Kickoff & Live Voice Q&A',
        description: 'Open community voice hangout covering custom server databases, bots, and Nitro features.',
        startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        locationLabel: 'Voice Lounge',
        status: 'SCHEDULED',
        interestedUserIds: [sentinelBotUserId],
        createdBy: sentinelBotUserId,
        createdAt: now,
      },
    ],
    badges: DEFAULT_BADGES,
    communityIdeas: [
      {
        id: 'idea-community-databases',
        title: 'Move community databases into the admin console',
        description:
          'Give platform admins a first-class database explorer so every server table can be browsed, edited, and audited from one dashboard instead of hunting through individual servers.',
        category: 'Feature',
        status: 'SHIPPED',
        authorId: sentinelBotUserId,
        authorName: 'Snout Sentinel',
        upvoterIds: [sentinelBotUserId],
        adminResponse: 'Shipped in the Admin Console → Community Databases tab with live row editing.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'idea-profile-badges',
        title: 'Profile badges managed by platform admins',
        description:
          'Award founder, staff, developer, bug hunter, and custom badges that render on profiles, the member list, and chat.',
        category: 'Design',
        status: 'SHIPPED',
        authorId: sentinelBotUserId,
        authorName: 'Snout Sentinel',
        upvoterIds: [sentinelBotUserId],
        adminResponse: 'Badges are live — create custom badges and award them from Admin Console → Badges.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'idea-support-centre',
        title: 'Built-in support ticket centre',
        description:
          'Let members open tickets from inside Snout and let staff reply, prioritise, and resolve them without leaving the platform.',
        category: 'Feature',
        status: 'IN_PROGRESS',
        authorId: sentinelBotUserId,
        authorName: 'Snout Sentinel',
        upvoterIds: [sentinelBotUserId],
        adminResponse: 'Support Centre is live for members; admin SLA analytics are rolling out next.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'idea-stage-rooms',
        title: 'Townhall stage rooms with audience hand-raise',
        description:
          'Add a stage mode to voice channels with speaker slots, audience mute, and a hand-raise queue for community events.',
        category: 'Voice & Video',
        status: 'PLANNED',
        authorId: sentinelBotUserId,
        authorName: 'Snout Sentinel',
        upvoterIds: [sentinelBotUserId],
        adminResponse: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    supportTickets: [],
    voiceServers: createDefaultVoiceServers(),
    platformConfig: {
      maintenanceMode: false,
      registrationEnabled: true,
      nitroPriceUsd: 2.0,
      platega: { ...EMPTY_PLATEGA_CONFIG },
    },
  };
}

class DbStore {
  public state: DatabaseState;
  private writePending = false;

  constructor() {
    this.state = this.load();
  }

  private load(): DatabaseState {
    const initial = createInitialState();
    const hydrate = (parsed: Partial<DatabaseState>): DatabaseState => {
      const merged: DatabaseState = {
        ...initial,
        ...parsed,
        serverDatabases: parsed.serverDatabases && parsed.serverDatabases.length > 0 ? parsed.serverDatabases : initial.serverDatabases,
        serverDatabaseRows: parsed.serverDatabaseRows && parsed.serverDatabaseRows.length > 0 ? parsed.serverDatabaseRows : initial.serverDatabaseRows,
        bookmarks: parsed.bookmarks || [],
        scheduledEvents: parsed.scheduledEvents && parsed.scheduledEvents.length > 0 ? parsed.scheduledEvents : initial.scheduledEvents,
        badges: (() => {
          const byId = new Map<string, AdminBadge>();
          for (const badge of DEFAULT_BADGES) byId.set(badge.id, badge);
          for (const badge of parsed.badges || []) byId.set(badge.id, badge);
          return Array.from(byId.values()).sort((a, b) => b.priority - a.priority);
        })(),
        communityIdeas: parsed.communityIdeas || initial.communityIdeas,
        supportTickets: parsed.supportTickets || [],
        voiceServers:
          Array.isArray(parsed.voiceServers) && parsed.voiceServers.length > 0
            ? parsed.voiceServers
            : initial.voiceServers,
        platformConfig: {
          ...initial.platformConfig,
          ...(parsed.platformConfig || {}),
          platega: {
            ...EMPTY_PLATEGA_CONFIG,
            ...(parsed.platformConfig?.platega || {}),
          },
        },
      };
      const validBadgeIds = new Set(merged.badges.map((b) => b.id));
      for (const u of merged.users) {
        u.badgeIds = Array.isArray(u.badgeIds) ? u.badgeIds.filter((id) => validBadgeIds.has(id)) : [];
        if (u.id === 'bot-user-chord-sentinel' && u.displayName === 'CHORD Sentinel') {
          u.username = 'snout_sentinel';
          u.displayName = 'Snout Sentinel';
          u.bio = 'Official Snout platform utility & slash command bot.';
        }
      }
      for (const s of merged.servers) {
        if (s.id === 'server-chord-hub' && s.name === 'CHORD Community Hub') {
          s.name = 'Snout Community Hub';
          s.description = 'Official community workspace for real-time messaging, voice lounges, forums, and slash commands.';
        }
      }
      for (const b of merged.bots) {
        if (b.id === 'bot-app-chord-sentinel' && b.name === 'CHORD Sentinel') {
          b.name = 'Snout Sentinel';
        }
      }
      return merged;
    };

    try {
      const sqliteLoaded = loadStateFromSqlite();
      if (sqliteLoaded) {
        const merged = hydrate(sqliteLoaded);
        this.persistSync(merged);
        return merged;
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabaseState>;
        const merged = hydrate(parsed);
        this.persistSync(merged);
        return merged;
      }
    } catch (err) {
      console.error('Failed to load DB store, initializing fresh store:', err);
    }

    this.persistSync(initial);
    return initial;
  }

  private persistSync(data: DatabaseState) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    syncStateToSqlite(data);
    const tmpFile = `${DB_FILE}.${uuidv4()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  public save() {
    if (this.writePending) return;
    this.writePending = true;
    queueMicrotask(() => {
      this.writePending = false;
      try {
        this.persistSync(this.state);
      } catch (err) {
        console.error('Failed to persist DB store:', err);
      }
    });
  }

  public saveImmediate() {
    this.persistSync(this.state);
  }

  public toPublicUser(u: StoredUser): PublicUser {
    const badgeIds = u.badgeIds || [];
    const badges = (this.state.badges || [])
      .filter((b) => badgeIds.includes(b.id))
      .sort((a, b) => b.priority - a.priority);
    return {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      animatedAvatarUrl: u.animatedAvatarUrl,
      bannerUrl: u.bannerUrl,
      bio: u.bio,
      status: u.status,
      customStatus: u.customStatus,
      activityStatus: u.activityStatus,
      profileDecoration: u.profileDecoration,
      isNitro: u.isNitro,
      isBot: u.isBot,
      platformRole: u.platformRole,
      emailVerified: u.emailVerified,
      twoFactorEnabled: u.twoFactorEnabled,
      twoFactorBackupRemaining: u.twoFactorEnabled ? (u.twoFactorBackupHashes?.length ?? 0) : 0,
      badgeIds,
      badges,
      createdAt: u.createdAt,
    };
  }

  public addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt' | 'actorName'>) {
    const actor = this.state.users.find((u) => u.id === entry.actorId);
    const log: AuditLogEntry = {
      ...entry,
      id: uuidv4(),
      actorName: actor ? actor.displayName : 'System',
      createdAt: new Date().toISOString(),
    };
    this.state.auditLogs.unshift(log);
    if (this.state.auditLogs.length > 1000) {
      this.state.auditLogs = this.state.auditLogs.slice(0, 1000);
    }
    this.save();
    return log;
  }

  public addNotification(item: Omit<NotificationItem, 'id' | 'isRead' | 'createdAt'>) {
    const notif: NotificationItem = {
      ...item,
      id: uuidv4(),
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    this.state.notifications.unshift(notif);
    this.save();
    return notif;
  }
}

export const dbStore = new DbStore();
