import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { checkServerPermission, getHighestRolePosition, getMember } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';

export const rolesRouter = Router();

rolesRouter.post('/servers/:serverId/roles', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_ROLES)) {
    return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
  }
  const name = String(req.body?.name || 'New Role').trim().slice(0, 64);
  const color = String(req.body?.color || '#5865F2');
  const permissions = Number(req.body?.permissions ?? DEFAULT_MEMBER_PERMISSIONS);
  const hoist = Boolean(req.body?.hoist ?? true);
  const maxPos = dbStore.state.roles
    .filter((r) => r.serverId === serverId)
    .reduce((m, r) => Math.max(m, r.position), 0);

  const role = {
    id: uuidv4(),
    serverId,
    name,
    color,
    position: maxPos + 1,
    permissions,
    isDefault: false,
    hoist,
  };
  dbStore.state.roles.push(role);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'ROLE_CREATED',
    targetType: 'ROLE',
    targetId: role.id,
    details: `Created role "${role.name}"`,
  });
  dbStore.save();
  res.status(201).json({ role });
});

rolesRouter.patch('/servers/:serverId/roles/:roleId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, roleId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_ROLES)) {
    return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
  }
  const role = dbStore.state.roles.find((r) => r.id === roleId && r.serverId === serverId);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const { name, color, permissions, position, hoist } = req.body as Partial<typeof role>;
  if (name !== undefined && !role.isDefault) role.name = name.trim().slice(0, 64);
  if (color !== undefined) role.color = color;
  if (permissions !== undefined) role.permissions = Number(permissions);
  if (position !== undefined && !role.isDefault) role.position = Number(position);
  if (hoist !== undefined) role.hoist = Boolean(hoist);

  dbStore.save();
  res.json({ role });
});

rolesRouter.delete('/servers/:serverId/roles/:roleId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, roleId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_ROLES)) {
    return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
  }
  const role = dbStore.state.roles.find((r) => r.id === roleId && r.serverId === serverId);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.isDefault) return res.status(400).json({ error: 'Cannot delete @everyone role' });

  dbStore.state.roles = dbStore.state.roles.filter((r) => r.id !== roleId);
  dbStore.state.members.forEach((m) => {
    if (m.serverId === serverId) {
      m.roleIds = m.roleIds.filter((id) => id !== roleId);
    }
  });
  dbStore.save();
  res.json({ ok: true });
});

rolesRouter.put('/servers/:serverId/members/:targetUserId/roles', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, targetUserId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_ROLES)) {
    return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
  }
  const actorMember = getMember(serverId, req.user!.id);
  const targetMember = getMember(serverId, targetUserId);
  if (!actorMember || !targetMember) return res.status(404).json({ error: 'Member not found' });

  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (
    server?.ownerId !== req.user!.id &&
    getHighestRolePosition(serverId, actorMember) <= getHighestRolePosition(serverId, targetMember) &&
    req.user!.id !== targetUserId
  ) {
    return res.status(403).json({ error: 'Cannot modify roles of a member with equal or higher hierarchy' });
  }

  const roleIds: string[] = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(String) : [];
  const validRoleIds = new Set(dbStore.state.roles.filter((r) => r.serverId === serverId).map((r) => r.id));
  targetMember.roleIds = roleIds.filter((id) => validRoleIds.has(id));

  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'MEMBER_ROLES_UPDATED',
    targetType: 'USER',
    targetId: targetUserId,
    details: `Updated roles for member ${targetUserId}`,
  });
  dbStore.save();
  res.json({ member: targetMember });
});
