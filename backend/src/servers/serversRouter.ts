import crypto from 'crypto';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  MODERATOR_PERMISSIONS,
  PERMISSIONS,
} from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { checkServerPermission, computeMemberPermissions, getMember } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToServer } from '../websocket/socketGateway.ts';

export const serversRouter = Router();

const createServerSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  iconUrl: z.string().max(1024).nullable().optional(),
  bannerUrl: z.string().max(1024).nullable().optional(),
});

serversRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const memberServerIds = new Set(
    dbStore.state.members.filter((m) => m.userId === userId).map((m) => m.serverId)
  );
  const servers = dbStore.state.servers
    .filter((s) => memberServerIds.has(s.id))
    .map((s) => ({
      ...s,
      memberCount: dbStore.state.members.filter((m) => m.serverId === s.id).length,
    }));
  res.json({ servers });
});

serversRouter.get('/discover', requireAuth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const servers = dbStore.state.servers
    .filter(
      (s) =>
        s.isPublic &&
        (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    )
    .map((s) => ({
      ...s,
      memberCount: dbStore.state.members.filter((m) => m.serverId === s.id).length,
    }));
  res.json({ servers });
});

serversRouter.post('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = createServerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid server details', details: parsed.error.flatten() });
  }
  const userId = req.user!.id;
  const now = new Date().toISOString();
  const serverId = uuidv4();

  const server = {
    id: serverId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || '',
    iconUrl: parsed.data.iconUrl || null,
    bannerUrl: parsed.data.bannerUrl || null,
    ownerId: userId,
    isPublic: Boolean(parsed.data.isPublic),
    boostTier: req.user!.isNitro ? 1 : 0,
    createdAt: now,
  };

  const catTextId = uuidv4();
  const catVoiceId = uuidv4();
  const everyoneRoleId = uuidv4();
  const modRoleId = uuidv4();
  const adminRoleId = uuidv4();

  dbStore.state.servers.push(server);
  dbStore.state.categories.push(
    { id: catTextId, serverId, name: 'Text Channels', position: 0 },
    { id: catVoiceId, serverId, name: 'Voice Channels', position: 1 }
  );
  dbStore.state.channels.push(
    {
      id: uuidv4(),
      serverId,
      categoryId: catTextId,
      name: 'general',
      topic: `General discussion in ${server.name}`,
      type: 'TEXT',
      isPrivate: false,
      position: 0,
      bitrate: 64000,
      overrides: [],
      createdAt: now,
    },
    {
      id: uuidv4(),
      serverId,
      categoryId: catTextId,
      name: 'announcements',
      topic: 'Server updates and news',
      type: 'ANNOUNCEMENT',
      isPrivate: false,
      position: 1,
      bitrate: 64000,
      overrides: [],
      createdAt: now,
    },
    {
      id: uuidv4(),
      serverId,
      categoryId: catVoiceId,
      name: 'General Voice',
      topic: 'Drop in for voice, video, or screen sharing',
      type: 'VOICE',
      isPrivate: false,
      position: 2,
      bitrate: 96000,
      overrides: [],
      createdAt: now,
    }
  );
  dbStore.state.roles.push(
    {
      id: everyoneRoleId,
      serverId,
      name: '@everyone',
      color: '#94A3B8',
      position: 0,
      permissions: DEFAULT_MEMBER_PERMISSIONS,
      isDefault: true,
      hoist: false,
    },
    {
      id: modRoleId,
      serverId,
      name: 'Moderator',
      color: '#34D399',
      position: 1,
      permissions: MODERATOR_PERMISSIONS,
      isDefault: false,
      hoist: true,
    },
    {
      id: adminRoleId,
      serverId,
      name: 'Administrator',
      color: '#5865F2',
      position: 2,
      permissions: ALL_PERMISSIONS,
      isDefault: false,
      hoist: true,
    }
  );
  dbStore.state.members.push({
    id: uuidv4(),
    serverId,
    userId,
    nickname: null,
    roleIds: [everyoneRoleId, adminRoleId],
    joinedAt: now,
    timeoutUntil: null,
  });

  dbStore.addAuditLog({
    serverId,
    actorId: userId,
    action: 'SERVER_CREATED',
    targetType: 'SERVER',
    targetId: serverId,
    details: `Created server "${server.name}"`,
  });
  dbStore.save();

  res.status(201).json({ server: { ...server, memberCount: 1 } });
});

serversRouter.get('/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const member = getMember(serverId, userId);
  if (!member && !server.isPublic && req.user!.platformRole !== 'ADMIN') {
    return res.status(403).json({ error: 'You are not a member of this server' });
  }

  const categories = dbStore.state.categories
    .filter((c) => c.serverId === serverId)
    .sort((a, b) => a.position - b.position);

  const channels = dbStore.state.channels
    .filter((c) => c.serverId === serverId)
    .filter((c) => !member || checkServerPermission(serverId, userId, PERMISSIONS.READ_MESSAGES, c))
    .sort((a, b) => a.position - b.position);

  const roles = dbStore.state.roles
    .filter((r) => r.serverId === serverId)
    .sort((a, b) => b.position - a.position);

  const members = dbStore.state.members
    .filter((m) => m.serverId === serverId)
    .map((m) => {
      const u = dbStore.state.users.find((usr) => usr.id === m.userId);
      return {
        ...m,
        user: u ? dbStore.toPublicUser(u) : undefined,
      };
    })
    .filter((m) => Boolean(m.user));

  const myPermissions = member ? computeMemberPermissions(serverId, userId) : 0;

  res.json({
    server,
    categories,
    channels,
    roles,
    members,
    myPermissions,
  });
});

serversRouter.patch('/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER) && req.user!.platformRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Missing MANAGE_SERVER permission' });
  }

  const { name, description, isPublic, iconUrl, bannerUrl } = req.body as Partial<typeof server>;
  if (name !== undefined && name.trim().length >= 2) server.name = name.trim().slice(0, 100);
  if (description !== undefined) server.description = description.slice(0, 500);
  if (isPublic !== undefined) server.isPublic = Boolean(isPublic);
  if (iconUrl !== undefined) server.iconUrl = iconUrl;
  if (bannerUrl !== undefined) server.bannerUrl = bannerUrl;

  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'SERVER_UPDATED',
    targetType: 'SERVER',
    targetId: serverId,
    details: `Updated settings for "${server.name}"`,
  });
  dbStore.save();
  emitToServer(serverId, 'server:updated', { serverId });
  res.json({ server });
});

serversRouter.delete('/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (server.ownerId !== req.user!.id && req.user!.platformRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Only the server owner can delete this server' });
  }

  dbStore.state.servers = dbStore.state.servers.filter((s) => s.id !== serverId);
  dbStore.state.categories = dbStore.state.categories.filter((c) => c.serverId !== serverId);
  const channelIds = new Set(
    dbStore.state.channels.filter((c) => c.serverId === serverId).map((c) => c.id)
  );
  dbStore.state.channels = dbStore.state.channels.filter((c) => c.serverId !== serverId);
  dbStore.state.messages = dbStore.state.messages.filter((m) => !m.channelId || !channelIds.has(m.channelId));
  dbStore.state.roles = dbStore.state.roles.filter((r) => r.serverId !== serverId);
  dbStore.state.members = dbStore.state.members.filter((m) => m.serverId !== serverId);
  dbStore.state.invites = dbStore.state.invites.filter((i) => i.serverId !== serverId);
  dbStore.state.bans = dbStore.state.bans.filter((b) => b.serverId !== serverId);
  dbStore.save();
  res.json({ ok: true });
});

serversRouter.post('/:serverId/join', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (!server.isPublic) return res.status(403).json({ error: 'This server requires an invite link' });

  const banned = dbStore.state.bans.some((b) => b.serverId === serverId && b.userId === userId);
  if (banned) return res.status(403).json({ error: 'You are banned from this server' });

  const existing = getMember(serverId, userId);
  if (existing) return res.json({ ok: true, alreadyMember: true });

  const defaultRole = dbStore.state.roles.find((r) => r.serverId === serverId && r.isDefault);
  dbStore.state.members.push({
    id: uuidv4(),
    serverId,
    userId,
    nickname: null,
    roleIds: defaultRole ? [defaultRole.id] : [],
    joinedAt: new Date().toISOString(),
    timeoutUntil: null,
  });
  dbStore.save();
  emitToServer(serverId, 'server:updated', { serverId });
  res.status(201).json({ ok: true, server });
});

serversRouter.post('/:serverId/leave', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (server.ownerId === userId) {
    return res.status(400).json({ error: 'Server owners must transfer ownership or delete the server before leaving' });
  }
  dbStore.state.members = dbStore.state.members.filter(
    (m) => !(m.serverId === serverId && m.userId === userId)
  );
  dbStore.save();
  emitToServer(serverId, 'server:updated', { serverId });
  res.json({ ok: true });
});

serversRouter.get('/:serverId/invites', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!getMember(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a server member' });
  }
  const invites = dbStore.state.invites.filter((i) => i.serverId === serverId);
  res.json({ invites });
});

serversRouter.post('/:serverId/invites', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.CREATE_INVITES)) {
    return res.status(403).json({ error: 'Missing CREATE_INVITES permission' });
  }
  const maxUses = req.body?.maxUses ? Number(req.body.maxUses) : null;
  const expiresHours = req.body?.expiresHours ? Number(req.body.expiresHours) : null;
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const invite = {
    code,
    serverId,
    creatorId: req.user!.id,
    maxUses,
    uses: 0,
    expiresAt: expiresHours ? new Date(Date.now() + expiresHours * 3600 * 1000).toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  dbStore.state.invites.push(invite);
  dbStore.save();
  res.status(201).json({ invite });
});

serversRouter.post('/invites/:code/join', requireAuth, (req: AuthenticatedRequest, res) => {
  const code = req.params.code.trim().toUpperCase();
  const invite = dbStore.state.invites.find((i) => i.code.toUpperCase() === code);
  if (!invite) return res.status(404).json({ error: 'Invite code not found' });
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Invite has expired' });
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return res.status(410).json({ error: 'Invite has reached maximum uses' });
  }

  const userId = req.user!.id;
  const banned = dbStore.state.bans.some((b) => b.serverId === invite.serverId && b.userId === userId);
  if (banned) return res.status(403).json({ error: 'You are banned from this server' });

  const server = dbStore.state.servers.find((s) => s.id === invite.serverId);
  if (!server) return res.status(404).json({ error: 'Server no longer exists' });

  if (!getMember(server.id, userId)) {
    const defaultRole = dbStore.state.roles.find((r) => r.serverId === server.id && r.isDefault);
    dbStore.state.members.push({
      id: uuidv4(),
      serverId: server.id,
      userId,
      nickname: null,
      roleIds: defaultRole ? [defaultRole.id] : [],
      joinedAt: new Date().toISOString(),
      timeoutUntil: null,
    });
    invite.uses += 1;
    dbStore.addAuditLog({
      serverId: server.id,
      actorId: userId,
      action: 'MEMBER_JOINED_INVITE',
      targetType: 'INVITE',
      targetId: invite.code,
      details: `${req.user!.username} joined via invite ${invite.code}`,
    });
    dbStore.save();
  }

  res.json({ ok: true, server });
});
