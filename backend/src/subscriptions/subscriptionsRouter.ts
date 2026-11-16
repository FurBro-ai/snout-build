import { Router } from 'express';
import { NITRO_PLAN } from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToUser } from '../websocket/socketGateway.ts';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  let subscription = dbStore.state.subscriptions.find((s) => s.userId === userId) || null;

  // Check expiration on read
  if (
    subscription &&
    subscription.status === 'ACTIVE' &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd).getTime() < Date.now()
  ) {
    subscription.status = 'EXPIRED';
    subscription.updatedAt = new Date().toISOString();
    req.user!.isNitro = false;
    dbStore.save();
  }

  const payments = dbStore.state.payments
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  res.json({
    isNitro: req.user!.isNitro,
    plan: NITRO_PLAN,
    subscription,
    payments,
  });
});

subscriptionsRouter.post('/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const sub = dbStore.state.subscriptions.find((s) => s.userId === userId);
  if (!sub || sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
    return res.status(404).json({ error: 'No active or pending subscription to cancel' });
  }

  const now = new Date().toISOString();
  sub.status = 'CANCELLED';
  sub.cancelledAt = now;
  sub.updatedAt = now;

  // Immediate cancellation if requested or if it was never paid (PENDING)
  if (req.body?.immediate === true || !sub.currentPeriodEnd) {
    req.user!.isNitro = false;
    req.user!.profileDecoration = 'none';
    req.user!.animatedAvatarUrl = null;
  }

  dbStore.addAuditLog({
    serverId: null,
    actorId: userId,
    action: 'SUBSCRIPTION_CANCELLED',
    targetType: 'SUBSCRIPTION',
    targetId: sub.id,
    details: 'User cancelled SNOUT NITRO subscription',
  });
  dbStore.save();

  emitToUser(userId, 'nitro:updated', { isNitro: req.user!.isNitro, subscription: sub });
  res.json({ subscription: sub, isNitro: req.user!.isNitro });
});
