import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { PERMISSIONS } from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { checkServerPermission } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToServer } from '../websocket/socketGateway.ts';

export const channelsRouter = Router();

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  topic: z.string().max(500).optional(),
  type: z.enum(['TEXT', 'VOICE', 'ANNOUNCEMENT', 'FORUM']).default('TEXT'),
  categoryId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
});

channelsRouter.post('/servers/:serverId/categories', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 64) {
    return res.status(400).json({ error: 'Valid category name (1-64 chars) required' });
  }
  const existingCount = dbStore.state.categories.filter((c) => c.serverId === serverId).length;
  const category = {
    id: uuidv4(),
    serverId,
    name,
    position: existingCount,
  };
  dbStore.state.categories.push(category);
  dbStore.save();
  emitToServer(serverId, 'server:updated', { serverId });
  res.status(201).json({ category });
});

channelsRouter.post('/servers/:serverId/channels', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid channel payload', details: parsed.error.flatten() });
  }

  const normalizedName =
    parsed.data.type === 'VOICE'
      ? parsed.data.name.trim()
      : parsed.data.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

  const existingCount = dbStore.state.channels.filter((c) => c.serverId === serverId).length;
  const channel = {
    id: uuidv4(),
    serverId,
    categoryId: parsed.data.categoryId ?? null,
    name: normalizedName || 'channel',
    topic: parsed.data.topic?.trim() || '',
    type: parsed.data.type,
    isPrivate: Boolean(parsed.data.isPrivate),
    position: existingCount,
    bitrate: 96000,
    overrides: [],
    createdAt: new Date().toISOString(),
  };

  dbStore.state.channels.push(channel);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'CHANNEL_CREATED',
    targetType: 'CHANNEL',
    targetId: channel.id,
    details: `Created ${channel.type} channel #${channel.name}`,
  });
  dbStore.save();
  emitToServer(serverId, 'server:updated', { serverId });
  res.status(201).json({ channel });
});

channelsRouter.patch('/channels/:channelId', requireAuth, (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }
  const { name, topic, isPrivate, categoryId } = req.body as Partial<typeof channel>;
  if (name !== undefined && name.trim()) channel.name = name.trim().slice(0, 100);
  if (topic !== undefined) channel.topic = topic.slice(0, 500);
  if (isPrivate !== undefined) channel.isPrivate = Boolean(isPrivate);
  if (categoryId !== undefined) channel.categoryId = categoryId;
  dbStore.save();
  emitToServer(channel.serverId, 'server:updated', { serverId: channel.serverId });
  res.json({ channel });
});

channelsRouter.put('/channels/:channelId/overrides', requireAuth, (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.MANAGE_ROLES)) {
    return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
  }
  const { targetType, targetId, allow, deny } = req.body as {
    targetType: 'ROLE' | 'USER';
    targetId: string;
    allow: number;
    deny: number;
  };
  if (!targetType || !targetId) return res.status(400).json({ error: 'targetType and targetId required' });

  const idx = channel.overrides.findIndex((o) => o.targetType === targetType && o.targetId === targetId);
  const override = {
    id: idx >= 0 ? channel.overrides[idx].id : uuidv4(),
    channelId: channel.id,
    targetType,
    targetId,
    allow: Number(allow || 0),
    deny: Number(deny || 0),
  };
  if (idx >= 0) {
    channel.overrides[idx] = override;
  } else {
    channel.overrides.push(override);
  }
  dbStore.save();
  emitToServer(channel.serverId, 'server:updated', { serverId: channel.serverId });
  res.json({ channel });
});

channelsRouter.delete('/channels/:channelId', requireAuth, (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }
  dbStore.state.channels = dbStore.state.channels.filter((c) => c.id !== channel.id);
  dbStore.state.messages = dbStore.state.messages.filter((m) => m.channelId !== channel.id);
  dbStore.addAuditLog({
    serverId: channel.serverId,
    actorId: req.user!.id,
    action: 'CHANNEL_DELETED',
    targetType: 'CHANNEL',
    targetId: channel.id,
    details: `Deleted channel #${channel.name}`,
  });
  dbStore.save();
  emitToServer(channel.serverId, 'server:updated', { serverId: channel.serverId });
  res.json({ ok: true });
});
