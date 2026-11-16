export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type PlatformRole = 'USER' | 'ADMIN';

export interface AdminBadge {
  id: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  priority: number;
  isSystem: boolean;
  createdAt: string;
}
export type ChannelType = 'TEXT' | 'VOICE' | 'ANNOUNCEMENT' | 'FORUM';
export type SubscriptionStatus = 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'NONE';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'DISPUTED' | 'CHARGEBACKED' | 'FAILED';

export interface PublicUser {
  id: string;
  username: string;
  discriminator: string;
  displayName: string;
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
  platformRole: PlatformRole;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  twoFactorBackupRemaining?: number;
  badgeIds: string[];
  badges?: AdminBadge[];
  createdAt: string;
}

export interface UserSession {
  id: string;
  userId: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current?: boolean;
}

export interface FriendRelation {
  id: string;
  user: PublicUser;
  createdAt: string;
}

export interface FriendRequestRecord {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  sender?: PublicUser;
  receiver?: PublicUser;
  createdAt: string;
}

export interface DirectThread {
  id: string;
  isGroup: boolean;
  name: string | null;
  ownerId: string | null;
  participantIds: string[];
  participants: PublicUser[];
  lastMessageAt: string;
  unreadCount?: number;
}

export interface ServerCategory {
  id: string;
  serverId: string;
  name: string;
  position: number;
}

export interface ChannelPermissionOverride {
  id: string;
  channelId: string;
  targetType: 'ROLE' | 'USER';
  targetId: string;
  allow: number;
  deny: number;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  topic: string;
  type: ChannelType;
  isPrivate: boolean;
  position: number;
  bitrate: number;
  overrides: ChannelPermissionOverride[];
  createdAt: string;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string;
  position: number;
  permissions: number;
  isDefault: boolean;
  hoist: boolean;
}

export interface ServerMember {
  id: string;
  serverId: string;
  userId: string;
  nickname: string | null;
  roleIds: string[];
  joinedAt: string;
  timeoutUntil: string | null;
  user?: PublicUser;
}

export interface ServerInvite {
  code: string;
  serverId: string;
  creatorId: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ServerBan {
  id: string;
  serverId: string;
  userId: string;
  bannedBy: string;
  reason: string;
  createdAt: string;
  user?: PublicUser;
}

export interface Server {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  ownerId: string;
  isPublic: boolean;
  boostTier: number;
  memberCount?: number;
  createdAt: string;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  isVoiceMessage?: boolean;
  durationSec?: number;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  domain: string;
}

export interface Message {
  id: string;
  channelId: string | null;
  threadId: string | null;
  serverId: string | null;
  authorId: string;
  author?: PublicUser;
  content: string;
  replyToId: string | null;
  replyToMessage?: { id: string; authorName: string; content: string } | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  mentions: string[];
  linkPreview: LinkPreview | null;
  isPinned: boolean;
  isEdited: boolean;
  isForumPost?: boolean;
  forumTitle?: string | null;
  readByIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceParticipant {
  userId: string;
  channelId: string;
  serverId: string | null;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  speaking: boolean;
  pushToTalk: boolean;
  joinedAt: string;
  user?: PublicUser;
}

/* ------------------------------------------------------------------ */
/* Voice relay / media node fleet                                      */
/* ------------------------------------------------------------------ */

export type VoiceNodeStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

export type VoiceRegionGroup = 'oceania' | 'europe' | 'north-america' | 'south-america' | 'asia' | 'africa' | 'middle-east' | 'global';

export interface VoiceServerNode {
  id: string;
  name: string;
  regionLabel: string;
  regionCode: string;
  regionGroup: VoiceRegionGroup;
  host: string;
  turnPort: number;
  tlsPort: number | null;
  stunUrls: string[];
  turnSecret: string;
  healthUrl: string | null;
  priority: number;
  capacity: number;
  enabled: boolean;
  status: VoiceNodeStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastClientReportAt?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Node data safe to return to members. Never contains the TURN secret. */
export interface PublicVoiceServerNode {
  id: string;
  name: string;
  regionLabel: string;
  regionCode: string;
  regionGroup: VoiceRegionGroup;
  host: string;
  turnPort: number;
  priority: number;
  capacity: number;
  enabled: boolean;
  status: VoiceNodeStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastClientReportAt?: string | null;
  iceServers: RTCIceServer[];
}

export interface VoiceNodeHealth {
  nodeId: string;
  reachable: boolean;
  latencyMs: number | null;
  checkedAt: string;
  detail: string;
}

export interface SlashCommand {
  id: string;
  botId: string;
  name: string;
  description: string;
  options: Array<{ name: string; description: string; required: boolean }>;
}

export interface BotApp {
  id: string;
  ownerId: string;
  botUserId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  tokenPrefix: string;
  permissions: number;
  webhookUrl: string | null;
  subscribedEvents: string[];
  slashCommands: SlashCommand[];
  installedServerIds: string[];
  createdAt: string;
}

export interface ChannelWebhook {
  id: string;
  serverId: string;
  channelId: string;
  name: string;
  avatarUrl: string | null;
  token: string;
  createdBy: string;
  createdAt: string;
}

export interface BotLog {
  id: string;
  botId: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  message: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'FRIEND_REQUEST' | 'MENTION' | 'SERVER_INVITE' | 'NITRO_PAYMENT' | 'SYSTEM';
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  plategaTransactionId: string | null;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: number;
  redirectUrl: string | null;
  providerResponse: Record<string, unknown> | null;
  webhookEvents: Array<{ receivedAt: string; status: string; rawPayload: unknown }>;
  createdAt: string;
  confirmedAt: string | null;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  priceUsd: number;
  currency: string;
  interval: 'month';
  autoRenewSupported: boolean;
  renewalDisclosure: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  lastPaymentId: string | null;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  serverId: string | null;
  actorId: string;
  actorName?: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export type DatabaseColumnType = 'text' | 'number' | 'status' | 'checkbox' | 'date' | 'url';

export interface ServerDatabaseColumn {
  id: string;
  name: string;
  type: DatabaseColumnType;
  options?: string[];
}

export interface ServerDatabaseRow {
  id: string;
  tableId: string;
  serverId: string;
  cells: Record<string, string | number | boolean>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerDatabaseTable {
  id: string;
  serverId: string;
  name: string;
  description: string;
  icon: string;
  columns: ServerDatabaseColumn[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkItem {
  id: string;
  userId: string;
  messageId: string;
  channelId: string | null;
  threadId: string | null;
  serverId: string | null;
  authorName: string;
  channelName: string;
  content: string;
  note: string;
  createdAt: string;
}

export interface ScheduledEvent {
  id: string;
  serverId: string;
  channelId: string | null;
  title: string;
  description: string;
  startsAt: string;
  locationLabel: string;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  interestedUserIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface DatabaseTableMeta {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: boolean }>;
}

export interface DatabaseEngineSummary {
  engine: string;
  sqliteVersion: string;
  journalMode: string;
  dbPath: string;
  sizeBytes: number;
  pageSize: number;
  pageCount: number;
  firestoreDatabaseId: string;
  tables: DatabaseTableMeta[];
}

export interface SqlQueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Community roadmap votes                                             */
/* ------------------------------------------------------------------ */

export type IdeaCategory = 'Feature' | 'Voice & Video' | 'Bots & API' | 'Design' | 'Billing' | 'Other';
export type IdeaStatus = 'UNDER_REVIEW' | 'PLANNED' | 'IN_PROGRESS' | 'SHIPPED' | 'DECLINED';

export interface CommunityIdea {
  id: string;
  title: string;
  description: string;
  category: IdeaCategory;
  status: IdeaStatus;
  authorId: string;
  authorName: string;
  author?: PublicUser | null;
  upvoterIds: string[];
  adminResponse: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Support centre tickets                                              */
/* ------------------------------------------------------------------ */

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type TicketCategory = 'Account' | 'Billing' | 'Bug Report' | 'Feature Request' | 'Safety' | 'Other';

export interface SupportTicketMessage {
  id: string;
  authorId: string;
  authorName: string;
  isStaff: boolean;
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  username: string;
  email: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  messages: SupportTicketMessage[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Platega integration overrides (admin console)                       */
/* ------------------------------------------------------------------ */

export interface PlategaIntegrationConfig {
  merchantId: string;
  secret: string;
  webhookSecret: string;
  apiUrl: string;
  sandboxMode: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}


