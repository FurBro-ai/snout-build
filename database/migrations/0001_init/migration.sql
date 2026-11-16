-- CHORD PostgreSQL Initial Migration (0001_init)
-- Covers Users, Sessions, Friends, FriendRequests, Blocks, Servers, ServerMembers,
-- Channels, Roles, Permissions, Messages, Reactions, Attachments, Bots, BotApplications,
-- Webhooks, Notifications, Payments, Subscriptions, SubscriptionEntitlements, AuditLogs.

CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'IDLE', 'DND', 'OFFLINE');
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'VOICE', 'ANNOUNCEMENT', 'FORUM');
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED', 'DISPUTED', 'CHARGEBACKED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "discriminator" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "twoFactorSecret" TEXT,
  "avatarUrl" TEXT,
  "animatedAvatarUrl" TEXT,
  "bannerUrl" TEXT,
  "bio" TEXT NOT NULL DEFAULT '',
  "status" "PresenceStatus" NOT NULL DEFAULT 'ONLINE',
  "customStatus" TEXT NOT NULL DEFAULT '',
  "activityStatus" TEXT NOT NULL DEFAULT '',
  "profileDecoration" TEXT NOT NULL DEFAULT 'none',
  "isNitro" BOOLEAN NOT NULL DEFAULT FALSE,
  "isBot" BOOLEAN NOT NULL DEFAULT FALSE,
  "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "userAgent" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Friend" (
  "id" TEXT PRIMARY KEY,
  "userAId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "userBId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("userAId", "userBId")
);

CREATE TABLE "FriendRequest" (
  "id" TEXT PRIMARY KEY,
  "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "receiverId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("senderId", "receiverId")
);

CREATE TABLE "Block" (
  "id" TEXT PRIMARY KEY,
  "blockerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "blockedId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("blockerId", "blockedId")
);

CREATE TABLE "Server" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "iconUrl" TEXT,
  "bannerUrl" TEXT,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id"),
  "isPublic" BOOLEAN NOT NULL DEFAULT FALSE,
  "boostTier" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ServerMember" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL REFERENCES "Server"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "nickname" TEXT,
  "timeoutUntil" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("serverId", "userId")
);

CREATE TABLE "Channel" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL REFERENCES "Server"("id") ON DELETE CASCADE,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "topic" TEXT NOT NULL DEFAULT '',
  "type" "ChannelType" NOT NULL DEFAULT 'TEXT',
  "isPrivate" BOOLEAN NOT NULL DEFAULT FALSE,
  "position" INTEGER NOT NULL DEFAULT 0,
  "bitrate" INTEGER NOT NULL DEFAULT 64000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Role" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL REFERENCES "Server"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#94A3B8',
  "position" INTEGER NOT NULL DEFAULT 0,
  "permissions" INTEGER NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "hoist" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE "Permission" (
  "id" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "allow" INTEGER NOT NULL DEFAULT 0,
  "deny" INTEGER NOT NULL DEFAULT 0,
  UNIQUE("channelId", "targetType", "targetId")
);

CREATE TABLE "Message" (
  "id" TEXT PRIMARY KEY,
  "channelId" TEXT REFERENCES "Channel"("id") ON DELETE CASCADE,
  "threadId" TEXT,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "content" TEXT NOT NULL,
  "replyToId" TEXT,
  "isPinned" BOOLEAN NOT NULL DEFAULT FALSE,
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  "forumTitle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Reaction" (
  "id" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "emoji" TEXT NOT NULL,
  UNIQUE("messageId", "userId", "emoji")
);

CREATE TABLE "Attachment" (
  "id" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "isVoiceMessage" BOOLEAN NOT NULL DEFAULT FALSE,
  "durationSec" INTEGER
);

CREATE TABLE "BotApplication" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "clientId" TEXT NOT NULL UNIQUE,
  "oauthRedirectUri" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Bot" (
  "id" TEXT PRIMARY KEY,
  "applicationId" TEXT NOT NULL REFERENCES "BotApplication"("id") ON DELETE CASCADE,
  "botUserId" TEXT NOT NULL UNIQUE,
  "tokenHash" TEXT NOT NULL,
  "permissions" INTEGER NOT NULL DEFAULT 0,
  "webhookUrl" TEXT,
  "subscribedEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Webhook" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL REFERENCES "Server"("id") ON DELETE CASCADE,
  "channelId" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Notification" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linkUrl" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Payment" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "plategaTransactionId" TEXT UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "planId" TEXT NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" INTEGER NOT NULL DEFAULT 2,
  "redirectUrl" TEXT,
  "providerPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3)
);

CREATE TABLE "Subscription" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "planId" TEXT NOT NULL DEFAULT 'chord_nitro_monthly',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "priceUsd" DECIMAL(10, 2) NOT NULL DEFAULT 2.00,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lastPaymentId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SubscriptionEntitlement" (
  "id" TEXT PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL REFERENCES "Subscription"("id") ON DELETE CASCADE,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "limitValue" INTEGER,
  UNIQUE("subscriptionId", "featureKey")
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT REFERENCES "Server"("id") ON DELETE SET NULL,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_message_channel_created" ON "Message"("channelId", "createdAt");
CREATE INDEX "idx_message_thread_created" ON "Message"("threadId", "createdAt");
CREATE INDEX "idx_payment_user" ON "Payment"("userId");
CREATE INDEX "idx_audit_server_created" ON "AuditLog"("serverId", "createdAt");
