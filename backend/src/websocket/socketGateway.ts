import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { PresenceStatus, VoiceParticipant } from '../../../shared/types.ts';
import { PERMISSIONS } from '../../../shared/constants.ts';
import { authenticateToken } from '../auth/authMiddleware.ts';
import { checkServerPermission } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';
import { sanitizeCustomSoundCue } from '../../../shared/soundboard.ts';

let ioInstance: SocketIOServer | null = null;
const activeVoiceParticipants = new Map<string, VoiceParticipant>(); // key: userId
const onlineSocketCounts = new Map<string, number>();

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function getVoiceParticipants(channelId?: string): VoiceParticipant[] {
  const all = Array.from(activeVoiceParticipants.values()).map((vp) => {
    const u = dbStore.state.users.find((usr) => usr.id === vp.userId);
    return { ...vp, user: u ? dbStore.toPublicUser(u) : undefined };
  });
  return channelId ? all.filter((v) => v.channelId === channelId) : all;
}

export function emitToChannel(channelId: string, event: string, payload: unknown) {
  ioInstance?.to(`channel:${channelId}`).emit(event, payload);
}

export function emitToThread(threadId: string, event: string, payload: unknown) {
  ioInstance?.to(`thread:${threadId}`).emit(event, payload);
}

export function emitToServer(serverId: string, event: string, payload: unknown) {
  ioInstance?.to(`server:${serverId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  if (event === 'session:revoked') {
    const sessionId = (payload as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sessionId === 'string') {
      disconnectSessionSockets(sessionId, payload);
    } else {
      ioInstance?.to(`user:${userId}`).emit(event, payload);
      ioInstance?.in(`user:${userId}`).disconnectSockets(true);
    }
    return;
  }
  ioInstance?.to(`user:${userId}`).emit(event, payload);
}

export function disconnectSessionSockets(sessionId: string, payload: unknown = { sessionId }): void {
  const sessionRoom = ioInstance?.in(`session:${sessionId}`);
  sessionRoom?.emit('session:revoked', payload);
  sessionRoom?.disconnectSockets(true);
}

export function emitGlobal(event: string, payload: unknown) {
  ioInstance?.emit(event, payload);
}

function canRelayVoiceSignal(fromUserId: string, targetUserId: string, channelId: string): boolean {
  return Boolean(
    channelId &&
      fromUserId !== targetUserId &&
      activeVoiceParticipants.get(fromUserId)?.channelId === channelId &&
      activeVoiceParticipants.get(targetUserId)?.channelId === channelId
  );
}

function broadcastVoiceParticipants(channelId: string): void {
  if (!ioInstance) return;
  const isDirectVoice = channelId.startsWith('dm-');
  const thread = isDirectVoice
    ? dbStore.state.directThreads.find((item) => item.id === channelId.slice(3))
    : undefined;
  const channel = isDirectVoice
    ? undefined
    : dbStore.state.channels.find((item) => item.id === channelId && item.type === 'VOICE');
  const recipients = isDirectVoice
    ? thread?.participantIds || []
    : channel
      ? dbStore.state.users
          .filter((user) => checkServerPermission(channel.serverId, user.id, PERMISSIONS.READ_MESSAGES, channel))
          .map((user) => user.id)
      : [];
  const payload = { channelId, participants: getVoiceParticipants(channelId) };
  for (const recipientId of recipients) ioInstance.to(`user:${recipientId}`).emit('voice:participants', payload);
}

export function initSocketGateway(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });
  ioInstance = io;

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers.authorization?.replace('Bearer ', '') as string | undefined);
    if (!token) return next(new Error('Unauthorized'));
    const authResult = authenticateToken(token);
    if (!authResult) return next(new Error('Invalid token'));
    socket.data.userId = authResult.user.id;
    socket.data.sessionId = authResult.sessionId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    const sessionId = socket.data.sessionId as string;
    let soundboardWindowStartedAt = 0;
    let soundboardEventCount = 0;
    socket.join(`user:${userId}`);
    socket.join(`session:${sessionId}`);

    const prevCount = onlineSocketCounts.get(userId) || 0;
    onlineSocketCounts.set(userId, prevCount + 1);

    const user = dbStore.state.users.find((u) => u.id === userId);
    if (user && user.status === 'offline') {
      user.status = 'online';
      dbStore.save();
    }
    if (user) {
      io.emit('presence:update', {
        userId: user.id,
        status: user.status,
        customStatus: user.customStatus,
        activityStatus: user.activityStatus,
      });
    }

    // Join rooms for user's servers and DM threads
    const memberServerIds = dbStore.state.members
      .filter((m) => m.userId === userId)
      .map((m) => m.serverId);
    for (const sid of memberServerIds) {
      socket.join(`server:${sid}`);
      const serverChannels = dbStore.state.channels.filter(
        (channel) =>
          channel.serverId === sid &&
          checkServerPermission(sid, userId, PERMISSIONS.READ_MESSAGES, channel)
      );
      for (const ch of serverChannels) {
        socket.join(`channel:${ch.id}`);
      }
    }

    const userThreads = dbStore.state.directThreads.filter((t) =>
      t.participantIds.includes(userId)
    );
    for (const th of userThreads) {
      socket.join(`thread:${th.id}`);
    }

    socket.on('room:join', (room: { channelId?: string; threadId?: string; serverId?: string } | null) => {
      if (!room || typeof room !== 'object') return;
      if (typeof room.channelId === 'string') {
        const channel = dbStore.state.channels.find((item) => item.id === room.channelId);
        if (
          channel &&
          checkServerPermission(channel.serverId, userId, PERMISSIONS.READ_MESSAGES, channel)
        ) {
          socket.join(`channel:${channel.id}`);
        }
      }
      if (typeof room.threadId === 'string') {
        const thread = dbStore.state.directThreads.find((item) => item.id === room.threadId);
        if (thread?.participantIds.includes(userId)) socket.join(`thread:${thread.id}`);
      }
      if (typeof room.serverId === 'string') {
        const server = dbStore.state.servers.find((item) => item.id === room.serverId);
        const isMember = dbStore.state.members.some(
          (member) => member.serverId === room.serverId && member.userId === userId
        );
        if (server && (server.ownerId === userId || isMember)) socket.join(`server:${server.id}`);
      }
    });

    socket.on('presence:set', (payload: { status?: PresenceStatus; customStatus?: string; activityStatus?: string }) => {
      const targetUser = dbStore.state.users.find((u) => u.id === userId);
      if (!targetUser) return;
      if (payload.status) targetUser.status = payload.status;
      if (payload.customStatus !== undefined) targetUser.customStatus = payload.customStatus.slice(0, 128);
      if (payload.activityStatus !== undefined) targetUser.activityStatus = payload.activityStatus.slice(0, 128);
      dbStore.save();
      io.emit('presence:update', {
        userId,
        status: targetUser.status,
        customStatus: targetUser.customStatus,
        activityStatus: targetUser.activityStatus,
      });
    });

    socket.on('typing:start', (payload: { channelId?: string; threadId?: string }) => {
      const u = dbStore.state.users.find((usr) => usr.id === userId);
      const data = { userId, displayName: u?.displayName || 'Someone', ...payload };
      if (payload.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:update', { ...data, isTyping: true });
      } else if (payload.threadId) {
        socket.to(`thread:${payload.threadId}`).emit('typing:update', { ...data, isTyping: true });
      }
    });

    socket.on('typing:stop', (payload: { channelId?: string; threadId?: string }) => {
      const u = dbStore.state.users.find((usr) => usr.id === userId);
      const data = { userId, displayName: u?.displayName || 'Someone', ...payload };
      if (payload.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:update', { ...data, isTyping: false });
      } else if (payload.threadId) {
        socket.to(`thread:${payload.threadId}`).emit('typing:update', { ...data, isTyping: false });
      }
    });

    // Voice & WebRTC Signaling
    socket.on('voice:join', (payload: { channelId: string; serverId: string | null; pushToTalk?: boolean }) => {
      if (!payload || typeof payload.channelId !== 'string') return;
      const isDirectVoice = payload.channelId.startsWith('dm-') && payload.serverId === null;
      if (isDirectVoice) {
        const threadId = payload.channelId.slice(3);
        const thread = dbStore.state.directThreads.find((item) => item.id === threadId);
        if (!thread?.participantIds.includes(userId)) return;
      } else {
        const channel = dbStore.state.channels.find(
          (item) => item.id === payload.channelId && item.type === 'VOICE'
        );
        if (
          !channel ||
          channel.serverId !== payload.serverId ||
          !checkServerPermission(channel.serverId, userId, PERMISSIONS.READ_MESSAGES, channel) ||
          !checkServerPermission(channel.serverId, userId, PERMISSIONS.CONNECT_VOICE, channel)
        ) {
          return;
        }
      }
      const existing = activeVoiceParticipants.get(userId);
      if (existing && existing.channelId !== payload.channelId) {
        activeVoiceParticipants.delete(userId);
        socket.to(`voice:${existing.channelId}`).emit('voice:peer-left', { userId, channelId: existing.channelId });
        socket.leave(`voice:${existing.channelId}`);
        broadcastVoiceParticipants(existing.channelId);
      }

      const participant: VoiceParticipant = {
        userId,
        channelId: payload.channelId,
        serverId: payload.serverId,
        muted: false,
        deafened: false,
        cameraOn: false,
        screenSharing: false,
        speaking: false,
        pushToTalk: Boolean(payload.pushToTalk),
        joinedAt: new Date().toISOString(),
      };
      activeVoiceParticipants.set(userId, participant);
      socket.join(`voice:${payload.channelId}`);

      const peers = getVoiceParticipants(payload.channelId);
      broadcastVoiceParticipants(payload.channelId);
      socket.to(`voice:${payload.channelId}`).emit('voice:peer-joined', { userId, channelId: payload.channelId });
    });

    socket.on('voice:state', (patch: Partial<Pick<VoiceParticipant, 'muted' | 'deafened' | 'cameraOn' | 'screenSharing' | 'speaking' | 'pushToTalk'>> | null) => {
      const current = activeVoiceParticipants.get(userId);
      if (!current || !patch || typeof patch !== 'object') return;
      const allowedKeys = ['muted', 'deafened', 'cameraOn', 'screenSharing', 'speaking', 'pushToTalk'] as const;
      for (const key of allowedKeys) {
        if (typeof patch[key] === 'boolean') current[key] = patch[key]!;
      }
      activeVoiceParticipants.set(userId, current);
      broadcastVoiceParticipants(current.channelId);
    });

    socket.on('voice:leave', () => {
      const current = activeVoiceParticipants.get(userId);
      if (!current) return;
      activeVoiceParticipants.delete(userId);
      socket.leave(`voice:${current.channelId}`);
      socket.to(`voice:${current.channelId}`).emit('voice:peer-left', { userId, channelId: current.channelId });
      broadcastVoiceParticipants(current.channelId);
    });

    socket.on('voice:soundboard', (payload: { channelId: string; cueId: string; customCue?: unknown } | null) => {
      if (!payload || typeof payload.channelId !== 'string' || typeof payload.cueId !== 'string') return;
      const current = activeVoiceParticipants.get(userId);
      if (!current || current.channelId !== payload.channelId) return;
      const now = Date.now();
      if (now - soundboardWindowStartedAt >= 10_000) {
        soundboardWindowStartedAt = now;
        soundboardEventCount = 0;
      }
      if (++soundboardEventCount > 10) return;
      const customCue = payload.customCue === undefined ? null : sanitizeCustomSoundCue(payload.customCue);
      if (payload.customCue !== undefined && !customCue) return;
      const u = dbStore.state.users.find((usr) => usr.id === userId);
      io.to(`voice:${payload.channelId}`).emit('voice:soundboard', {
        channelId: payload.channelId,
        cueId: payload.cueId.slice(0, 72),
        customCue,
        userId,
        displayName: u?.displayName || 'Member',
      });
    });

    // WebRTC Peer Signaling
    socket.on('webrtc:offer', (payload: { targetUserId: string; channelId: string; sdp: unknown; streamMap?: Record<string, 'camera' | 'screen'> }) => {
      if (!payload || !canRelayVoiceSignal(userId, payload.targetUserId, payload.channelId)) return;
      io.to(`user:${payload.targetUserId}`).emit('webrtc:offer', {
        fromUserId: userId,
        channelId: payload.channelId,
        sdp: payload.sdp,
        streamMap: payload.streamMap,
      });
    });

    socket.on('webrtc:answer', (payload: { targetUserId: string; channelId: string; sdp: unknown; streamMap?: Record<string, 'camera' | 'screen'> }) => {
      if (!payload || !canRelayVoiceSignal(userId, payload.targetUserId, payload.channelId)) return;
      io.to(`user:${payload.targetUserId}`).emit('webrtc:answer', {
        fromUserId: userId,
        channelId: payload.channelId,
        sdp: payload.sdp,
        streamMap: payload.streamMap,
      });
    });

    socket.on('webrtc:ice-candidate', (payload: { targetUserId: string; channelId: string; candidate: unknown }) => {
      if (!payload || !canRelayVoiceSignal(userId, payload.targetUserId, payload.channelId)) return;
      io.to(`user:${payload.targetUserId}`).emit('webrtc:ice-candidate', {
        fromUserId: userId,
        channelId: payload.channelId,
        candidate: payload.candidate,
      });
    });

    socket.on('disconnect', () => {
      const count = (onlineSocketCounts.get(userId) || 1) - 1;
      if (count <= 0) {
        onlineSocketCounts.delete(userId);
        const vp = activeVoiceParticipants.get(userId);
        if (vp) {
          activeVoiceParticipants.delete(userId);
          io.to(`voice:${vp.channelId}`).emit('voice:peer-left', { userId, channelId: vp.channelId });
          broadcastVoiceParticipants(vp.channelId);
        }
        const target = dbStore.state.users.find((u) => u.id === userId);
        if (target) {
          target.status = 'offline';
          dbStore.save();
          io.emit('presence:update', {
            userId,
            status: 'offline',
            customStatus: target.customStatus,
            activityStatus: target.activityStatus,
          });
        }
      } else {
        onlineSocketCounts.set(userId, count);
      }
    });
  });

  return io;
}
