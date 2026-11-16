import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  hasPermission,
} from '../../../shared/constants.ts';
import type { Channel, ServerMember } from '../../../shared/types.ts';
import { dbStore } from '../store/dbStore.ts';

export function getMember(serverId: string, userId: string): ServerMember | undefined {
  return dbStore.state.members.find((m) => m.serverId === serverId && m.userId === userId);
}

export function isMemberTimedOut(member: ServerMember | undefined): boolean {
  if (!member || !member.timeoutUntil) return false;
  return new Date(member.timeoutUntil).getTime() > Date.now();
}

export function getHighestRolePosition(serverId: string, member: ServerMember): number {
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (server && server.ownerId === member.userId) return Number.MAX_SAFE_INTEGER;
  const roles = dbStore.state.roles.filter(
    (r) => r.serverId === serverId && (r.isDefault || member.roleIds.includes(r.id))
  );
  return roles.reduce((max, r) => Math.max(max, r.position), 0);
}

export function computeMemberPermissions(
  serverId: string,
  userId: string,
  channel?: Channel
): number {
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return 0;
  if (server.ownerId === userId) return ALL_PERMISSIONS;

  const member = getMember(serverId, userId);
  if (!member) return 0;

  const serverRoles = dbStore.state.roles.filter((r) => r.serverId === serverId);
  const everyoneRole = serverRoles.find((r) => r.isDefault);

  let mask = everyoneRole ? everyoneRole.permissions : 0;
  for (const role of serverRoles) {
    if (member.roleIds.includes(role.id)) {
      mask |= role.permissions;
    }
  }

  if ((mask & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  if (channel) {
    // Apply @everyone channel override first
    if (everyoneRole) {
      const everyoneOv = channel.overrides.find(
        (o) => o.targetType === 'ROLE' && o.targetId === everyoneRole.id
      );
      if (everyoneOv) {
        mask &= ~everyoneOv.deny;
        mask |= everyoneOv.allow;
      }
    }

    // Apply role overrides
    let roleAllow = 0;
    let roleDeny = 0;
    for (const roleId of member.roleIds) {
      const ov = channel.overrides.find(
        (o) => o.targetType === 'ROLE' && o.targetId === roleId
      );
      if (ov) {
        roleAllow |= ov.allow;
        roleDeny |= ov.deny;
      }
    }
    mask &= ~roleDeny;
    mask |= roleAllow;

    // Apply user-specific override
    const userOv = channel.overrides.find(
      (o) => o.targetType === 'USER' && o.targetId === userId
    );
    if (userOv) {
      mask &= ~userOv.deny;
      mask |= userOv.allow;
    }

    if (channel.isPrivate && !userOv && !member.roleIds.some((rid) => channel.overrides.some((o) => o.targetType === 'ROLE' && o.targetId === rid && (o.allow & PERMISSIONS.READ_MESSAGES) !== 0))) {
      mask &= ~PERMISSIONS.READ_MESSAGES;
    }
  }

  return mask;
}

export function checkServerPermission(
  serverId: string,
  userId: string,
  permission: number,
  channel?: Channel
): boolean {
  const mask = computeMemberPermissions(serverId, userId, channel);
  return hasPermission(mask, permission);
}
