import { Router } from 'express';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';

export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const notifications = dbStore.state.notifications
    .filter((n) => n.userId === req.user!.id)
    .slice(0, 50);
  res.json({ notifications });
});

notificationsRouter.post('/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  dbStore.state.notifications.forEach((n) => {
    if (n.userId === req.user!.id) n.isRead = true;
  });
  dbStore.save();
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const notif = dbStore.state.notifications.find(
    (n) => n.id === req.params.id && n.userId === req.user!.id
  );
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  notif.isRead = true;
  dbStore.save();
  res.json({ ok: true });
});
