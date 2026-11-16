import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';

export const friendsRouter = Router();

friendsRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;

  const friends = dbStore.state.friends
    .filter((f) => f.userAId === userId || f.userBId === userId)
    .map((f) => {
      const otherId = f.userAId === userId ? f.userBId : f.userAId;
      const other = dbStore.state.users.find((u) => u.id === otherId);
      return other ? { id: f.id, user: dbStore.toPublicUser(other), createdAt: f.createdAt } : null;
    })
    .filter(Boolean);

  const incomingRequests = dbStore.state.friendRequests
    .filter((r) => r.receiverId === userId && r.status === 'PENDING')
    .map((r) => {
      const sender = dbStore.state.users.find((u) => u.id === r.senderId);
      return { ...r, sender: sender ? dbStore.toPublicUser(sender) : undefined };
    });

  const outgoingRequests = dbStore.state.friendRequests
    .filter((r) => r.senderId === userId && r.status === 'PENDING')
    .map((r) => {
      const receiver = dbStore.state.users.find((u) => u.id === r.receiverId);
      return { ...r, receiver: receiver ? dbStore.toPublicUser(receiver) : undefined };
    });

  const blocked = dbStore.state.blocks
    .filter((b) => b.blockerId === userId)
    .map((b) => {
      const target = dbStore.state.users.find((u) => u.id === b.blockedId);
      return target ? { id: b.id, user: dbStore.toPublicUser(target), createdAt: b.createdAt } : null;
    })
    .filter(Boolean);

  res.json({ friends, incomingRequests, outgoingRequests, blocked });
});

friendsRouter.post('/requests', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.user!.id;
  const targetQuery = String(req.body?.target || '').trim();
  if (!targetQuery) {
    return res.status(400).json({ error: 'Username or User ID is required' });
  }

  const target = dbStore.state.users.find(
    (u) =>
      !u.isBot &&
      (u.id === targetQuery || u.username.toLowerCase() === targetQuery.toLowerCase())
  );

  if (!target) {
    return res.status(404).json({ error: `No Snout user found matching "${targetQuery}"` });
  }
  if (target.id === senderId) {
    return res.status(400).json({ error: 'You cannot send a friend request to yourself' });
  }

  const isBlocked = dbStore.state.blocks.some(
    (b) =>
      (b.blockerId === target.id && b.blockedId === senderId) ||
      (b.blockerId === senderId && b.blockedId === target.id)
  );
  if (isBlocked) {
    return res.status(403).json({ error: 'Cannot send friend request due to block settings' });
  }

  const alreadyFriends = dbStore.state.friends.some(
    (f) =>
      (f.userAId === senderId && f.userBId === target.id) ||
      (f.userAId === target.id && f.userBId === senderId)
  );
  if (alreadyFriends) {
    return res.status(409).json({ error: 'You are already friends with this user' });
  }

  // If the other user already sent a pending request, accept it automatically
  const reverse = dbStore.state.friendRequests.find(
    (r) => r.senderId === target.id && r.receiverId === senderId && r.status === 'PENDING'
  );
  if (reverse) {
    reverse.status = 'ACCEPTED';
    const relation = {
      id: uuidv4(),
      userAId: senderId,
      userBId: target.id,
      createdAt: new Date().toISOString(),
    };
    dbStore.state.friends.push(relation);
    dbStore.save();
    return res.status(201).json({ acceptedImmediately: true, friend: dbStore.toPublicUser(target) });
  }

  const existing = dbStore.state.friendRequests.find(
    (r) => r.senderId === senderId && r.receiverId === target.id && r.status === 'PENDING'
  );
  if (existing) {
    return res.status(409).json({ error: 'Friend request already pending' });
  }

  const request = {
    id: uuidv4(),
    senderId,
    receiverId: target.id,
    status: 'PENDING' as const,
    createdAt: new Date().toISOString(),
  };
  dbStore.state.friendRequests.push(request);
  dbStore.addNotification({
    userId: target.id,
    type: 'FRIEND_REQUEST',
    title: 'New Friend Request',
    body: `${req.user!.displayName} (@${req.user!.username}) sent you a friend request.`,
    linkUrl: '/friends',
  });
  dbStore.save();

  res.status(201).json({
    request: {
      ...request,
      receiver: dbStore.toPublicUser(target),
    },
  });
});

friendsRouter.post('/requests/:requestId/respond', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { action } = req.body as { action?: 'ACCEPT' | 'DECLINE' };
  const request = dbStore.state.friendRequests.find(
    (r) => r.id === req.params.requestId && r.receiverId === userId && r.status === 'PENDING'
  );
  if (!request) {
    return res.status(404).json({ error: 'Pending friend request not found' });
  }

  if (action === 'ACCEPT') {
    request.status = 'ACCEPTED';
    dbStore.state.friends.push({
      id: uuidv4(),
      userAId: request.senderId,
      userBId: request.receiverId,
      createdAt: new Date().toISOString(),
    });
  } else {
    request.status = 'DECLINED';
  }
  dbStore.save();
  res.json({ ok: true, status: request.status });
});

friendsRouter.delete('/:friendUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const targetId = req.params.friendUserId;
  dbStore.state.friends = dbStore.state.friends.filter(
    (f) =>
      !(
        (f.userAId === userId && f.userBId === targetId) ||
        (f.userAId === targetId && f.userBId === userId)
      )
  );
  dbStore.save();
  res.json({ ok: true });
});

friendsRouter.post('/block/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const blockerId = req.user!.id;
  const blockedId = req.params.targetUserId;
  if (blockerId === blockedId) return res.status(400).json({ error: 'Cannot block yourself' });

  dbStore.state.friends = dbStore.state.friends.filter(
    (f) =>
      !(
        (f.userAId === blockerId && f.userBId === blockedId) ||
        (f.userAId === blockedId && f.userBId === blockerId)
      )
  );
  dbStore.state.friendRequests = dbStore.state.friendRequests.filter(
    (r) =>
      !(
        (r.senderId === blockerId && r.receiverId === blockedId) ||
        (r.senderId === blockedId && r.receiverId === blockerId)
      )
  );
  const exists = dbStore.state.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId);
  if (!exists) {
    dbStore.state.blocks.push({
      id: uuidv4(),
      blockerId,
      blockedId,
      createdAt: new Date().toISOString(),
    });
  }
  dbStore.save();
  res.json({ ok: true });
});

friendsRouter.delete('/block/:targetUserId', requireAuth, (req: AuthenticatedRequest, res) => {
  const blockerId = req.user!.id;
  const blockedId = req.params.targetUserId;
  dbStore.state.blocks = dbStore.state.blocks.filter(
    (b) => !(b.blockerId === blockerId && b.blockedId === blockedId)
  );
  dbStore.save();
  res.json({ ok: true });
});
