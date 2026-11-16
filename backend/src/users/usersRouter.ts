import { Router } from 'express';
import { z } from 'zod';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitGlobal } from '../websocket/socketGateway.ts';

export const usersRouter = Router();

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.\-]+$/).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().max(1024).nullable().optional(),
  animatedAvatarUrl: z.string().max(1024).nullable().optional(),
  bannerUrl: z.string().max(1024).nullable().optional(),
  status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
  customStatus: z.string().max(128).optional(),
  activityStatus: z.string().max(128).optional(),
  profileDecoration: z.string().max(64).optional(),
});

usersRouter.get('/search', requireAuth, (req: AuthenticatedRequest, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ users: [] });
  const users = dbStore.state.users
    .filter(
      (u) =>
        !u.isSuspended &&
        u.id !== req.user!.id &&
        (u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          u.id.toLowerCase() === q)
    )
    .slice(0, 20)
    .map((u) => dbStore.toPublicUser(u));
  res.json({ users });
});

usersRouter.get('/:userId', requireAuth, (req, res) => {
  const user = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: dbStore.toPublicUser(user) });
});

usersRouter.patch('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid profile update payload', details: parsed.error.flatten() });
  }
  const user = req.user!;
  const data = parsed.data;

  if (data.username && data.username.toLowerCase() !== user.username.toLowerCase()) {
    if (data.username.toLowerCase() === 'xyz' && user.platformRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Username "xyz" is reserved for platform administrators.' });
    }
    const taken = dbStore.state.users.some(
      (u) => u.id !== user.id && u.username.toLowerCase() === data.username!.toLowerCase()
    );
    if (taken) return res.status(409).json({ error: 'Username is already taken' });
    user.username = data.username;
  }

  // Enforce Nitro entitlements for premium customizations
  if (data.animatedAvatarUrl !== undefined && data.animatedAvatarUrl !== null && !user.isNitro) {
    return res.status(403).json({ error: 'SNOUT NITRO ($2.00/month) is required for animated profile avatars.' });
  }
  if (data.bannerUrl !== undefined && data.bannerUrl !== null && !user.isNitro) {
    return res.status(403).json({ error: 'SNOUT NITRO ($2.00/month) is required for custom profile banners.' });
  }
  if (data.profileDecoration && data.profileDecoration !== 'none' && !user.isNitro) {
    return res.status(403).json({ error: 'SNOUT NITRO ($2.00/month) is required for custom profile decorations.' });
  }

  if (data.displayName !== undefined) user.displayName = data.displayName;
  if (data.bio !== undefined) user.bio = data.bio;
  if (data.avatarUrl !== undefined) user.avatarUrl = data.avatarUrl;
  if (data.animatedAvatarUrl !== undefined) user.animatedAvatarUrl = data.animatedAvatarUrl;
  if (data.bannerUrl !== undefined) user.bannerUrl = data.bannerUrl;
  if (data.status !== undefined) user.status = data.status;
  if (data.customStatus !== undefined) user.customStatus = data.customStatus;
  if (data.activityStatus !== undefined) user.activityStatus = data.activityStatus;
  if (data.profileDecoration !== undefined) user.profileDecoration = data.profileDecoration;
  user.updatedAt = new Date().toISOString();

  dbStore.save();
  const publicUser = dbStore.toPublicUser(user);
  emitGlobal('user:updated', { user: publicUser });
  res.json({ user: publicUser });
});
