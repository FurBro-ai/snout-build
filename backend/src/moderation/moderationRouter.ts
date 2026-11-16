import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PERMISSIONS } from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { checkServerPermission, getHighestRolePosition, getMember } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';

export const moderationRouter = Router();

moderationRouter.post('/servers/:serverId/kick/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, targetUserId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.KICK_MEMBERS)) {
    return res.status(403).json({ error: 'Missing KICK_MEMBERS permission' });
  }
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (server?.ownerId === targetUserId) return res.status(403).json({ error: 'Cannot kick the server owner' });

  const actor = getMember(serverId, req.user!.id);
  const target = getMember(serverId, targetUserId);
  if (!actor || !target) return res.status(404).json({ error: 'Member not found' });
  if (server?.ownerId !== req.user!.id && getHighestRolePosition(serverId, actor) <= getHighestRolePosition(serverId, target)) {
    return res.status(403).json({ error: 'Cannot kick a member with equal or higher role' });
  }

  dbStore.state.members = dbStore.state.members.filter(
    (m) => !(m.serverId === serverId && m.userId === targetUserId)
  );
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'MEMBER_KICKED',
    targetType: 'USER',
    targetId: targetUserId,
    details: String(req.body?.reason || 'No reason provided'),
  });
  dbStore.save();
  res.json({ ok: true });
});

moderationRouter.post('/servers/:serverId/ban/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, targetUserId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.BAN_MEMBERS)) {
    return res.status(403).json({ error: 'Missing BAN_MEMBERS permission' });
  }
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (server?.ownerId === targetUserId) return res.status(403).json({ error: 'Cannot ban the server owner' });

  const reason = String(req.body?.reason || 'Violated server rules').slice(0, 300);
  dbStore.state.members = dbStore.state.members.filter(
    (m) => !(m.serverId === serverId && m.userId === targetUserId)
  );
  if (!dbStore.state.bans.some((b) => b.serverId === serverId && b.userId === targetUserId)) {
    dbStore.state.bans.push({
      id: uuidv4(),
      serverId,
      userId: targetUserId,
      bannedBy: req.user!.id,
      reason,
      createdAt: new Date().toISOString(),
    });
  }
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'MEMBER_BANNED',
    targetType: 'USER',
    targetId: targetUserId,
    details: reason,
  });
  dbStore.save();
  res.json({ ok: true });
});

moderationRouter.delete('/servers/:serverId/ban/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, targetUserId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.BAN_MEMBERS)) {
    return res.status(403).json({ error: 'Missing BAN_MEMBERS permission' });
  }
  dbStore.state.bans = dbStore.state.bans.filter(
    (b) => !(b.serverId === serverId && b.userId === targetUserId)
  );
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'MEMBER_UNBANNED',
    targetType: 'USER',
    targetId: targetUserId,
    details: 'Ban revoked',
  });
  dbStore.save();
  res.json({ ok: true });
});

moderationRouter.get('/servers/:serverId/bans', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.BAN_MEMBERS)) {
    return res.status(403).json({ error: 'Missing BAN_MEMBERS permission' });
  }
  const bans = dbStore.state.bans
    .filter((b) => b.serverId === serverId)
    .map((b) => {
      const u = dbStore.state.users.find((usr) => usr.id === b.userId);
      return { ...b, user: u ? dbStore.toPublicUser(u) : undefined };
    });
  res.json({ bans });
});

moderationRouter.post('/servers/:serverId/timeout/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, targetUserId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.TIMEOUT_MEMBERS)) {
    return res.status(403).json({ error: 'Missing TIMEOUT_MEMBERS permission' });
  }
  const member = getMember(serverId, targetUserId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const minutes = Number(req.body?.minutes ?? 10);
  member.timeoutUntil = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: minutes > 0 ? 'MEMBER_TIMED_OUT' : 'MEMBER_TIMEOUT_CLEARED',
    targetType: 'USER',
    targetId: targetUserId,
    details: minutes > 0 ? `Timed out for ${minutes} minutes` : 'Timeout cleared',
  });
  dbStore.save();
  res.json({ member });
});

moderationRouter.get('/servers/:serverId/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.VIEW_AUDIT_LOG)) {
    return res.status(403).json({ error: 'Missing VIEW_AUDIT_LOG permission' });
  }
  const logs = dbStore.state.auditLogs.filter((l) => l.serverId === serverId).slice(0, 100);
  res.json({ logs });
});
