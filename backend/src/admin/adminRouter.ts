import { Router } from 'express';
import { adminExtrasRouter } from './adminExtrasRouter.ts';
import { voiceServersAdminRouter } from './voiceServersAdminRouter.ts';
import { type AuthenticatedRequest, requireAdmin, requireAuth } from '../auth/authMiddleware.ts';
import {
  getPlategaRuntimeConfig,
  getPlategaWebhookUrl,
  getNitroPriceUsd,
  isPlategaConfiguredNow,
} from '../payments/plategaService.ts';
import { activateNitroForUser, revokeNitroForUser } from '../payments/plategaService.ts';
import { dbStore, DEFAULT_BADGES } from '../store/dbStore.ts';
import {
  executeReadOnlySql,
  getSqliteEngineSummary,
  getSqliteTableRows,
  runSqliteMaintenance,
} from '../store/sqliteEngine.ts';
import {
  emitGlobal,
  emitToServer,
  emitToUser,
  getIO,
  getVoiceParticipants,
} from '../websocket/socketGateway.ts';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);
adminRouter.use(adminExtrasRouter);
adminRouter.use(voiceServersAdminRouter);

function publicPlatformConfig() {
  const platega = getPlategaRuntimeConfig();
  return {
    maintenanceMode: dbStore.state.platformConfig.maintenanceMode,
    registrationEnabled: dbStore.state.platformConfig.registrationEnabled,
    nitroPriceUsd: getNitroPriceUsd(),
    platega: {
      configured: isPlategaConfiguredNow(),
      source: platega.source,
      apiUrl: platega.apiUrl,
      merchantId: platega.merchantId,
      sandboxMode: platega.sandboxMode,
      updatedAt: dbStore.state.platformConfig.platega?.updatedAt || null,
    },
  };
}

function buildSevenDayActivitySeries() {
  const days: Array<{ date: string; label: string; messages: number; signups: number; revenueUsd: number }> = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const isoDate = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    days.push({ date: isoDate, label, messages: 0, signups: 0, revenueUsd: 0 });
  }

  const dayMap = new Map(days.map((d) => [d.date, d]));

  for (const m of dbStore.state.messages) {
    const dayKey = (m.createdAt || '').slice(0, 10);
    const bucket = dayMap.get(dayKey);
    if (bucket) bucket.messages += 1;
  }

  for (const u of dbStore.state.users) {
    if (u.isBot) continue;
    const dayKey = (u.createdAt || '').slice(0, 10);
    const bucket = dayMap.get(dayKey);
    if (bucket) bucket.signups += 1;
  }

  for (const p of dbStore.state.payments) {
    if (p.status !== 'CONFIRMED') continue;
    const dayKey = ((p.confirmedAt || p.createdAt) || '').slice(0, 10);
    const bucket = dayMap.get(dayKey);
    if (bucket) bucket.revenueUsd += Number(p.amount) || 0;
  }

  return days;
}

adminRouter.get('/overview', (_req, res) => {
  const humanUsers = dbStore.state.users.filter((u) => !u.isBot);
  const nowMs = Date.now();
  const activeSessions = dbStore.state.sessions.filter((s) => new Date(s.expiresAt).getTime() > nowMs);
  const confirmedPayments = dbStore.state.payments.filter((p) => p.status === 'CONFIRMED');
  const pendingPayments = dbStore.state.payments.filter((p) => p.status === 'PENDING');
  const totalRevenueUsd = confirmedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const io = getIO();

  res.json({
    stats: {
      totalUsers: humanUsers.length,
      verifiedUsersCount: humanUsers.filter((u) => u.emailVerified).length,
      twoFactorAdoptionCount: humanUsers.filter((u) => u.twoFactorEnabled).length,
      suspendedUsersCount: humanUsers.filter((u) => u.isSuspended).length,
      totalBots: dbStore.state.bots.length,
      totalServers: dbStore.state.servers.length,
      publicServersCount: dbStore.state.servers.filter((s) => s.isPublic).length,
      totalChannels: dbStore.state.channels.length,
      totalMessages: dbStore.state.messages.length,
      totalServerDatabases: dbStore.state.serverDatabases.length,
      totalDatabaseRows: dbStore.state.serverDatabaseRows.length,
      totalScheduledEvents: dbStore.state.scheduledEvents.length,
      totalBookmarks: dbStore.state.bookmarks.length,
      totalCommunityIdeas: dbStore.state.communityIdeas.length,
      totalSupportTickets: dbStore.state.supportTickets.length,
      openSupportTickets: dbStore.state.supportTickets.filter(
        (t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED'
      ).length,
      totalBadges: dbStore.state.badges.length,
      totalVoiceServers: dbStore.state.voiceServers.length,
      onlineVoiceServers: dbStore.state.voiceServers.filter((n) => n.enabled && n.status === 'ONLINE').length,
      voiceRelayCapacity: dbStore.state.voiceServers.filter((n) => n.enabled).reduce((sum, n) => sum + n.capacity, 0),
      activeNitroCount: dbStore.state.subscriptions.filter((s) => s.status === 'ACTIVE').length,
      confirmedPaymentsCount: confirmedPayments.length,
      pendingPaymentsCount: pendingPayments.length,
      totalRevenueUsd,
      activeSessionsCount: activeSessions.length,
      realtimeClientsCount: io?.engine?.clientsCount ?? 0,
      voiceParticipantsCount: getVoiceParticipants().length,
      processUptimeSeconds: Math.floor(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      plategaConfigured: isPlategaConfiguredNow(),
    },
    activitySeries: buildSevenDayActivitySeries(),
    platformConfig: publicPlatformConfig(),
  });
});

adminRouter.get('/database/summary', (_req, res) => {
  try {
    dbStore.saveImmediate();
    res.json({ summary: getSqliteEngineSummary() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

adminRouter.get('/database/table/:tableName', (req, res) => {
  try {
    dbStore.saveImmediate();
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);
    const data = getSqliteTableRows(req.params.tableName, limit, offset);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.post('/database/query', (req: AuthenticatedRequest, res) => {
  try {
    dbStore.saveImmediate();
    const sql = String(req.body?.sql || '');
    const result = executeReadOnlySql(sql);
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.post('/database/maintenance', (req: AuthenticatedRequest, res) => {
  try {
    dbStore.saveImmediate();
    const report = runSqliteMaintenance();
    dbStore.addAuditLog({
      serverId: null,
      actorId: req.user!.id,
      action: 'ADMIN_DB_MAINTENANCE',
      targetType: 'DATABASE',
      targetId: 'snout.db',
      details: `SQLite WAL checkpoint + VACUUM completed (integrity: ${report.integrity}, size: ${report.sizeBytes} bytes)`,
    });
    res.json({ report, summary: getSqliteEngineSummary() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

adminRouter.get('/database/export', (_req, res) => {
  const sanitizedUsers = dbStore.state.users.map((u) => ({
    ...dbStore.toPublicUser(u),
    email: u.email,
    isSuspended: u.isSuspended,
  }));
  res.json({
    exportedAt: new Date().toISOString(),
    engine: 'snout-sqlite-v2',
    users: sanitizedUsers,
    servers: dbStore.state.servers,
    channels: dbStore.state.channels,
    serverDatabases: dbStore.state.serverDatabases,
    serverDatabaseRows: dbStore.state.serverDatabaseRows,
    scheduledEvents: dbStore.state.scheduledEvents,
    payments: dbStore.state.payments,
    subscriptions: dbStore.state.subscriptions,
    badges: dbStore.state.badges,
    communityIdeas: dbStore.state.communityIdeas,
    supportTickets: dbStore.state.supportTickets,
    platformConfig: publicPlatformConfig(),
  });
});

adminRouter.get('/users', (_req, res) => {
  const nowMs = Date.now();
  const users = dbStore.state.users
    .filter((u) => !u.isBot)
    .map((u) => {
      const activeSessionCount = dbStore.state.sessions.filter(
        (s) => s.userId === u.id && new Date(s.expiresAt).getTime() > nowMs
      ).length;
      const serverCount = dbStore.state.members.filter((m) => m.userId === u.id).length;
      const messageCount = dbStore.state.messages.filter((m) => m.authorId === u.id).length;
      return {
        ...dbStore.toPublicUser(u),
        email: u.email,
        isSuspended: u.isSuspended,
        activeSessionCount,
        serverCount,
        messageCount,
      };
    });
  res.json({ users });
});

adminRouter.get('/users/:userId/detail', (req, res) => {
  const target = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const nowMs = Date.now();
  const sessions = dbStore.state.sessions
    .filter((s) => s.userId === target.id && new Date(s.expiresAt).getTime() > nowMs)
    .map(({ tokenHash: _th, ...rest }) => rest);

  const memberServerIds = new Set(
    dbStore.state.members.filter((m) => m.userId === target.id).map((m) => m.serverId)
  );
  const servers = dbStore.state.servers
    .filter((s) => memberServerIds.has(s.id) || s.ownerId === target.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      isOwner: s.ownerId === target.id,
      isPublic: s.isPublic,
    }));

  const payments = dbStore.state.payments.filter((p) => p.userId === target.id);
  const subscription = dbStore.state.subscriptions.find((s) => s.userId === target.id) || null;
  const bots = dbStore.state.bots
    .filter((b) => b.ownerId === target.id)
    .map(({ tokenHash: _th, clientSecretHash: _csh, ...rest }) => rest);
  const messageCount = dbStore.state.messages.filter((m) => m.authorId === target.id).length;
  const bookmarkCount = dbStore.state.bookmarks.filter((b) => b.userId === target.id).length;
  const loginHistory = dbStore.state.auditLogs
    .filter((entry) => entry.action === 'USER_LOGIN' && entry.targetId === target.id)
    .slice(0, 100)
    .map(({ id, details, createdAt }) => ({ id, details, createdAt }));

  res.json({
    user: {
      ...dbStore.toPublicUser(target),
      email: target.email,
      isSuspended: target.isSuspended,
    },
    sessions,
    loginHistory,
    servers,
    payments,
    subscription,
    bots,
    messageCount,
    bookmarkCount,
  });
});

adminRouter.patch('/users/:userId', (req: AuthenticatedRequest, res) => {
  const target = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { isSuspended, platformRole, emailVerified, isNitro, displayName, customStatus } = req.body as {
    isSuspended?: boolean;
    platformRole?: 'USER' | 'ADMIN';
    emailVerified?: boolean;
    isNitro?: boolean;
    displayName?: string;
    customStatus?: string;
  };
  const previousSuspended = target.isSuspended;
  if (isSuspended !== undefined) {
    if (target.id === req.user!.id && isSuspended) {
      return res.status(400).json({ error: 'You cannot suspend your own active admin account' });
    }
    target.isSuspended = Boolean(isSuspended);
    if (target.isSuspended) {
      dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.userId !== target.id);
      emitToUser(target.id, 'session:revoked', { reason: 'Account suspended by administrator' });
    }
  }
  if (platformRole !== undefined) {
    if (platformRole !== 'USER' && platformRole !== 'ADMIN') {
      return res.status(400).json({ error: 'platformRole must be USER or ADMIN' });
    }
    if (target.id === req.user!.id && platformRole !== 'ADMIN') {
      return res.status(400).json({ error: 'You cannot demote your own active admin account' });
    }
    target.platformRole = platformRole;
  }
  if (emailVerified !== undefined) target.emailVerified = Boolean(emailVerified);
  if (displayName !== undefined) target.displayName = String(displayName).trim().slice(0, 48) || target.username;
  if (customStatus !== undefined) target.customStatus = String(customStatus).trim().slice(0, 128);
  if (isNitro !== undefined) {
    if (isNitro) {
      activateNitroForUser(target.id, 'admin-grant');
    } else {
      revokeNitroForUser(target.id, 'CANCELLED');
    }
  }
  target.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: isSuspended !== undefined && Boolean(isSuspended) !== previousSuspended
      ? isSuspended ? 'ADMIN_USER_BANNED' : 'ADMIN_USER_UNBANNED'
      : 'ADMIN_USER_MODIFIED',
    targetType: 'USER',
    targetId: target.id,
    details: isSuspended !== undefined && Boolean(isSuspended) !== previousSuspended
      ? `${isSuspended ? 'Banned' : 'Unbanned'} account @${target.username}`
      : `Admin updated user @${target.username}`,
  });
  dbStore.save();
  res.json({ user: dbStore.toPublicUser(target), isSuspended: target.isSuspended });
});

adminRouter.post('/users/:userId/revoke-sessions', (req: AuthenticatedRequest, res) => {
  const target = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const before = dbStore.state.sessions.length;
  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.userId !== target.id);
  const revokedCount = before - dbStore.state.sessions.length;

  emitToUser(target.id, 'session:revoked', { reason: 'Sessions revoked by administrator' });
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_SESSIONS_REVOKED',
    targetType: 'USER',
    targetId: target.id,
    details: `Revoked ${revokedCount} active session(s) for @${target.username}`,
  });
  dbStore.save();
  res.json({ ok: true, revokedCount });
});

adminRouter.post('/users/:userId/disable-2fa', (req: AuthenticatedRequest, res) => {
  const target = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  target.twoFactorEnabled = false;
  target.twoFactorSecret = null;
  target.twoFactorPendingSecret = null;
  target.twoFactorBackupHashes = [];
  target.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_2FA_RESET',
    targetType: 'USER',
    targetId: target.id,
    details: `Emergency 2FA reset performed for @${target.username}`,
  });
  dbStore.save();
  res.json({ user: dbStore.toPublicUser(target) });
});

adminRouter.delete('/users/:userId', (req: AuthenticatedRequest, res) => {
  const { userId } = req.params;
  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'You cannot delete your own currently active admin account' });
  }
  const target = dbStore.state.users.find((u) => u.id === userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  dbStore.state.users = dbStore.state.users.filter((u) => u.id !== userId);
  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.userId !== userId);
  dbStore.state.friends = dbStore.state.friends.filter((f) => f.userAId !== userId && f.userBId !== userId);
  dbStore.state.friendRequests = dbStore.state.friendRequests.filter(
    (r) => r.senderId !== userId && r.receiverId !== userId
  );
  dbStore.state.blocks = dbStore.state.blocks.filter((b) => b.blockerId !== userId && b.blockedId !== userId);
  dbStore.state.members = dbStore.state.members.filter((m) => m.userId !== userId);
  dbStore.state.bookmarks = dbStore.state.bookmarks.filter((b) => b.userId !== userId);
  dbStore.state.notifications = dbStore.state.notifications.filter((n) => n.userId !== userId);

  emitToUser(userId, 'session:revoked', { reason: 'Account removed by administrator' });
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_USER_DELETED',
    targetType: 'USER',
    targetId: userId,
    details: `Permanently removed user @${target.username}`,
  });
  dbStore.save();
  res.json({ ok: true });
});

adminRouter.get('/sessions', (_req, res) => {
  const nowMs = Date.now();
  const sessions = dbStore.state.sessions
    .filter((s) => new Date(s.expiresAt).getTime() > nowMs)
    .map(({ tokenHash: _th, ...s }) => {
      const user = dbStore.state.users.find((u) => u.id === s.userId);
      return {
        ...s,
        username: user?.username || s.userId,
        displayName: user?.displayName || 'Unknown',
        platformRole: user?.platformRole || 'USER',
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ sessions });
});

adminRouter.delete('/sessions/:sessionId', (req: AuthenticatedRequest, res) => {
  const target = dbStore.state.sessions.find((s) => s.id === req.params.sessionId);
  if (!target) return res.status(404).json({ error: 'Session not found' });

  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.id !== req.params.sessionId);
  emitToUser(target.userId, 'session:revoked', { sessionId: target.id });
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_SESSION_REVOKED',
    targetType: 'SESSION',
    targetId: target.id,
    details: `Revoked session ${target.id} for user ${target.userId}`,
  });
  dbStore.save();
  res.json({ ok: true });
});

adminRouter.get('/servers', (_req, res) => {
  const servers = dbStore.state.servers.map((s) => {
    const owner = dbStore.state.users.find((u) => u.id === s.ownerId);
    return {
      ...s,
      ownerUsername: owner?.username || s.ownerId,
      memberCount: dbStore.state.members.filter((m) => m.serverId === s.id).length,
      channelCount: dbStore.state.channels.filter((c) => c.serverId === s.id).length,
      messageCount: dbStore.state.messages.filter((m) => m.serverId === s.id).length,
      databaseCount: dbStore.state.serverDatabases.filter((d) => d.serverId === s.id).length,
      eventCount: dbStore.state.scheduledEvents.filter((e) => e.serverId === s.id).length,
    };
  });
  res.json({ servers });
});

adminRouter.get('/servers/:serverId/detail', (req, res) => {
  const server = dbStore.state.servers.find((s) => s.id === req.params.serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const owner = dbStore.state.users.find((u) => u.id === server.ownerId);
  const channels = dbStore.state.channels.filter((c) => c.serverId === server.id);
  const roles = dbStore.state.roles.filter((r) => r.serverId === server.id);
  const databases = dbStore.state.serverDatabases
    .filter((d) => d.serverId === server.id)
    .map((d) => ({
      ...d,
      rowCount: dbStore.state.serverDatabaseRows.filter((r) => r.tableId === d.id).length,
    }));
  const events = dbStore.state.scheduledEvents.filter((e) => e.serverId === server.id);
  const members = dbStore.state.members
    .filter((m) => m.serverId === server.id)
    .map((m) => {
      const u = dbStore.state.users.find((usr) => usr.id === m.userId);
      return {
        userId: m.userId,
        username: u?.username || m.userId,
        displayName: u?.displayName || 'Member',
        joinedAt: m.joinedAt,
      };
    });

  res.json({
    server: { ...server, ownerUsername: owner?.username || server.ownerId },
    channels,
    roles,
    databases,
    events,
    members,
  });
});

adminRouter.patch('/servers/:serverId', (req: AuthenticatedRequest, res) => {
  const server = dbStore.state.servers.find((s) => s.id === req.params.serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const { name, description, isPublic, boostTier } = req.body as {
    name?: string;
    description?: string;
    isPublic?: boolean;
    boostTier?: number;
  };
  if (name !== undefined && name.trim()) server.name = name.trim().slice(0, 80);
  if (description !== undefined) server.description = description.trim().slice(0, 300);
  if (isPublic !== undefined) server.isPublic = Boolean(isPublic);
  if (boostTier !== undefined && !Number.isNaN(Number(boostTier))) {
    server.boostTier = Math.max(0, Math.min(3, Math.floor(Number(boostTier))));
  }

  dbStore.addAuditLog({
    serverId: server.id,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_UPDATED',
    targetType: 'SERVER',
    targetId: server.id,
    details: `Admin updated server "${server.name}" (public: ${server.isPublic}, boostTier: ${server.boostTier})`,
  });
  dbStore.save();
  emitToServer(server.id, 'server:updated', { server });
  res.json({ server });
});

adminRouter.delete('/servers/:serverId', (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  dbStore.state.servers = dbStore.state.servers.filter((s) => s.id !== serverId);
  dbStore.state.channels = dbStore.state.channels.filter((c) => c.serverId !== serverId);
  dbStore.state.members = dbStore.state.members.filter((m) => m.serverId !== serverId);
  dbStore.state.roles = dbStore.state.roles.filter((r) => r.serverId !== serverId);
  dbStore.state.serverDatabases = dbStore.state.serverDatabases.filter((t) => t.serverId !== serverId);
  dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter((r) => r.serverId !== serverId);
  dbStore.state.scheduledEvents = dbStore.state.scheduledEvents.filter((e) => e.serverId !== serverId);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DELETED',
    targetType: 'SERVER',
    targetId: serverId,
    details: `Platform admin removed server ${serverId}`,
  });
  dbStore.save();
  res.json({ ok: true });
});

adminRouter.get('/workspace-assets', (_req, res) => {
  const databases = dbStore.state.serverDatabases.map((d) => {
    const srv = dbStore.state.servers.find((s) => s.id === d.serverId);
    const creator = dbStore.state.users.find((u) => u.id === d.createdBy);
    return {
      ...d,
      serverName: srv?.name || d.serverId,
      creatorUsername: creator?.username || d.createdBy,
      rowCount: dbStore.state.serverDatabaseRows.filter((r) => r.tableId === d.id).length,
    };
  });
  const events = dbStore.state.scheduledEvents.map((e) => {
    const srv = dbStore.state.servers.find((s) => s.id === e.serverId);
    const creator = dbStore.state.users.find((u) => u.id === e.createdBy);
    return {
      ...e,
      serverName: srv?.name || e.serverId,
      creatorUsername: creator?.username || e.createdBy,
      rsvpCount: e.interestedUserIds.length,
    };
  });
  res.json({ databases, events });
});

adminRouter.delete('/workspace-assets/databases/:tableId', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });

  dbStore.state.serverDatabases = dbStore.state.serverDatabases.filter((t) => t.id !== table.id);
  dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter((r) => r.tableId !== table.id);
  dbStore.addAuditLog({
    serverId: table.serverId,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DB_DELETED',
    targetType: 'SERVER_DATABASE',
    targetId: table.id,
    details: `Admin deleted server database "${table.name}"`,
  });
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.json({ ok: true });
});

adminRouter.delete('/workspace-assets/events/:eventId', (req: AuthenticatedRequest, res) => {
  const ev = dbStore.state.scheduledEvents.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'Scheduled event not found' });

  dbStore.state.scheduledEvents = dbStore.state.scheduledEvents.filter((e) => e.id !== ev.id);
  dbStore.addAuditLog({
    serverId: ev.serverId,
    actorId: req.user!.id,
    action: 'ADMIN_EVENT_DELETED',
    targetType: 'SCHEDULED_EVENT',
    targetId: ev.id,
    details: `Admin removed scheduled event "${ev.title}"`,
  });
  dbStore.save();
  emitToServer(ev.serverId, 'events:updated', { serverId: ev.serverId, eventId: ev.id });
  res.json({ ok: true });
});

adminRouter.get('/payments', (_req, res) => {
  const payments = dbStore.state.payments.map((p) => {
    const user = dbStore.state.users.find((u) => u.id === p.userId);
    return {
      ...p,
      username: user?.username || p.userId,
      email: user?.email || '',
    };
  });
  const subscriptions = dbStore.state.subscriptions.map((s) => {
    const user = dbStore.state.users.find((u) => u.id === s.userId);
    return {
      ...s,
      username: user?.username || s.userId,
    };
  });
  res.json({ payments, subscriptions });
});

adminRouter.post('/payments/:paymentId/confirm', (req: AuthenticatedRequest, res) => {
  const payment = dbStore.state.payments.find((p) => p.id === req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'CONFIRMED') {
    return res.json({ payment });
  }
  payment.status = 'CONFIRMED';
  payment.confirmedAt = new Date().toISOString();
  activateNitroForUser(payment.userId, payment.id);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_PAYMENT_CONFIRMED',
    targetType: 'PAYMENT',
    targetId: payment.id,
    details: `Admin manually confirmed payment ${payment.orderId} and activated Nitro`,
  });
  dbStore.save();
  res.json({ payment });
});

adminRouter.post('/payments/:paymentId/refund', (req: AuthenticatedRequest, res) => {
  const payment = dbStore.state.payments.find((p) => p.id === req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  payment.status = 'CHARGEBACKED';
  revokeNitroForUser(payment.userId, 'CANCELLED');
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_PAYMENT_REFUNDED',
    targetType: 'PAYMENT',
    targetId: payment.id,
    details: `Marked payment ${payment.orderId} as refunded/chargebacked and revoked Nitro`,
  });
  dbStore.save();
  res.json({ payment });
});

adminRouter.get('/bots', (_req, res) => {
  const bots = dbStore.state.bots.map(({ tokenHash: _th, clientSecretHash: _csh, ...rest }) => {
    const owner = dbStore.state.users.find((u) => u.id === rest.ownerId);
    const logCount = dbStore.state.botLogs.filter((l) => l.botId === rest.id).length;
    return {
      ...rest,
      ownerUsername: owner?.username || rest.ownerId,
      logCount,
    };
  });
  res.json({ bots });
});

adminRouter.delete('/bots/:botId', (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot application not found' });

  dbStore.state.bots = dbStore.state.bots.filter((b) => b.id !== bot.id);
  dbStore.state.users = dbStore.state.users.filter((u) => u.id !== bot.botUserId);
  dbStore.state.members = dbStore.state.members.filter((m) => m.userId !== bot.botUserId);
  dbStore.state.botLogs = dbStore.state.botLogs.filter((l) => l.botId !== bot.id);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_BOT_DELETED',
    targetType: 'BOT',
    targetId: bot.id,
    details: `Admin removed bot "${bot.name}"`,
  });
  dbStore.save();
  res.json({ ok: true });
});

adminRouter.get('/audit-logs', (_req, res) => {
  res.json({ logs: dbStore.state.auditLogs.slice(0, 300) });
});

adminRouter.patch('/config', (req: AuthenticatedRequest, res) => {
  const { maintenanceMode, registrationEnabled, nitroPriceUsd } = req.body as Partial<
    typeof dbStore.state.platformConfig
  >;
  if (maintenanceMode !== undefined) dbStore.state.platformConfig.maintenanceMode = Boolean(maintenanceMode);
  if (registrationEnabled !== undefined) {
    dbStore.state.platformConfig.registrationEnabled = Boolean(registrationEnabled);
  }
  if (nitroPriceUsd !== undefined && !Number.isNaN(Number(nitroPriceUsd))) {
    dbStore.state.platformConfig.nitroPriceUsd = Math.max(0.5, Number(Number(nitroPriceUsd).toFixed(2)));
  }
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_CONFIG_UPDATED',
    targetType: 'PLATFORM',
    targetId: 'config',
    details: JSON.stringify(publicPlatformConfig()),
  });
  dbStore.save();
  res.json({ platformConfig: publicPlatformConfig() });
});

adminRouter.post('/broadcast', (req: AuthenticatedRequest, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!title || !body) {
    return res.status(400).json({ error: 'Broadcast title and message are required' });
  }

  const humanUsers = dbStore.state.users.filter((u) => !u.isBot && !u.isSuspended);
  for (const recipient of humanUsers) {
    const notif = dbStore.addNotification({
      userId: recipient.id,
      type: 'SYSTEM',
      title: title.slice(0, 96),
      body: body.slice(0, 500),
      linkUrl: null,
    });
    emitToUser(recipient.id, 'notification:new', notif);
  }

  emitGlobal('platform:broadcast', {
    title: title.slice(0, 96),
    body: body.slice(0, 500),
    sentBy: req.user!.username,
    sentAt: new Date().toISOString(),
  });

  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_BROADCAST_SENT',
    targetType: 'PLATFORM',
    targetId: 'broadcast',
    details: `Sent platform broadcast "${title.slice(0, 96)}" to ${humanUsers.length} user(s)`,
  });
  dbStore.save();
  res.status(201).json({ ok: true, recipientCount: humanUsers.length });
});
