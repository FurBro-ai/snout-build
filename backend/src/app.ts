import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { adminRouter } from './admin/adminRouter.ts';
import { authRouter } from './auth/authRouter.ts';
import { botsRouter } from './bots/botsRouter.ts';
import { channelsRouter } from './channels/channelsRouter.ts';
import { communityRouter } from './community/communityRouter.ts';
import { UPLOADS_DIR } from './config/uploads.ts';
import { ENV } from './config/env.ts';
import { serverDatabasesRouter } from './databases/serverDatabasesRouter.ts';
import { friendsRouter } from './friends/friendsRouter.ts';
import { messagesRouter } from './messages/messagesRouter.ts';
import { moderationRouter } from './moderation/moderationRouter.ts';
import { notificationsRouter } from './notifications/notificationsRouter.ts';
import { paymentsRouter } from './payments/paymentsRouter.ts';
import { rolesRouter } from './roles/rolesRouter.ts';
import { serversRouter } from './servers/serversRouter.ts';
import { subscriptionsRouter } from './subscriptions/subscriptionsRouter.ts';
import { supportRouter } from './support/supportRouter.ts';
import { usersRouter } from './users/usersRouter.ts';
import { getVoiceParticipants } from './websocket/socketGateway.ts';
import { dbStore } from './store/dbStore.ts';
import { requireAuth, type AuthenticatedRequest } from './auth/authMiddleware.ts';
import { checkServerPermission } from './permissions/permissionService.ts';
import { PERMISSIONS } from '../../shared/constants.ts';
import {
  getIceConfigForUser,
  listVoiceNodes,
  pickPreferredVoiceNode,
  reportVoiceNodeHealth,
  toPublicVoiceNode,
} from './voice/voiceNodeService.ts';
import { createHmac } from 'crypto';
import { extname } from 'path';

export function createChordApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const uploadsDir = UPLOADS_DIR;
  app.use('/uploads', (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (['.html', '.htm', '.xhtml', '.svg', '.xml'].includes(extname(req.path).toLowerCase())) {
      res.setHeader('Content-Disposition', 'attachment');
    }
    next();
  }, express.static(uploadsDir));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'snout-api', database: 'sqlite-wal', timestamp: new Date().toISOString() });
  });

  app.get('/api/platform/summary', (_req, res) => {
    const memberCount = dbStore.state.users.filter((u) => !u.isBot && !u.isSuspended).length;
    const serverCount = dbStore.state.servers.length;
    const channelCount = dbStore.state.channels.length;
    const messageCount = dbStore.state.messages.length;
    const databaseTableCount = dbStore.state.serverDatabases.length;
    res.json({ memberCount, serverCount, channelCount, messageCount, databaseTableCount });
  });

  app.get('/api/voice/participants', requireAuth, (req: AuthenticatedRequest, res) => {
    const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
    const visible = getVoiceParticipants(channelId).filter((participant) => {
      if (participant.channelId.startsWith('dm-')) {
        const thread = dbStore.state.directThreads.find((item) => item.id === participant.channelId.slice(3));
        return Boolean(thread?.participantIds.includes(req.user!.id));
      }
      const channel = dbStore.state.channels.find((item) => item.id === participant.channelId && item.type === 'VOICE');
      return Boolean(channel && checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.READ_MESSAGES, channel));
    });
    res.json({ participants: visible });
  });

  app.get('/api/voice/nodes', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const nodes = listVoiceNodes().map((node) => toPublicVoiceNode(node, userId));
    const preferred = pickPreferredVoiceNode(listVoiceNodes());
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      nodes,
      serverPreferredNodeId: preferred?.id || null,
      selection: 'client-latency',
      generatedAt: new Date().toISOString(),
    });
  });

  app.post('/api/voice/nodes/report', requireAuth, (req: AuthenticatedRequest, res) => {
    const nodeId = String(req.body?.nodeId || '');
    const ok = Boolean(req.body?.ok);
    const rawLatency = req.body?.latencyMs;
    const latencyMs = rawLatency === null || rawLatency === undefined ? null : Number(rawLatency);
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
    if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 60_000)) {
      return res.status(400).json({ error: 'latencyMs is out of range' });
    }
    const result = reportVoiceNodeHealth(nodeId, req.user!.id, latencyMs, ok);
    res.status(result.accepted ? 202 : 429).json({ accepted: result.accepted });
  });

  app.get('/api/voice/ice-config', requireAuth, (req: AuthenticatedRequest, res) => {    const nodeId = req.query.nodeId ? String(req.query.nodeId) : undefined;
    const resolved = getIceConfigForUser(req.user!.id, nodeId);
    const iceServers: RTCIceServer[] = [...resolved.iceServers];

    // Environment fallback for deployments that have not migrated to the
    // managed voice fleet yet.
    const turnUrls = ENV.TURN_URLS.split(',').map((url) => url.trim()).filter((url) => /^turns?:/i.test(url));
    if (!resolved.node && ENV.TURN_SECRET && turnUrls.length > 0) {
      const username = `${Math.floor(Date.now() / 1000) + 30 * 60}:${req.user!.id}`;
      const credential = createHmac('sha1', ENV.TURN_SECRET).update(username).digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      iceServers,
      nodeId: resolved.node?.id || null,
      nodeName: resolved.node?.name || null,
      regionLabel: resolved.node?.regionLabel || null,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/servers', serversRouter);
  app.use('/api', channelsRouter);
  app.use('/api', serverDatabasesRouter);
  app.use('/api', rolesRouter);
  app.use('/api', moderationRouter);
  app.use('/api', messagesRouter);
  app.use('/api/bots', botsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/support', supportRouter);

  // Unknown API routes must always answer in JSON, never fall through to the
  // SPA/static handlers (which are registered later by server.ts / api/index.ts).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found', path: req.originalUrl });
  });

  // Global error handler: guarantees JSON for unhandled exceptions instead of
  // Express' default HTML error page. Must stay after all routes.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);

    const error = err as {
      name?: string;
      code?: string;
      message?: string;
      status?: number;
      statusCode?: number;
      type?: string;
    };
    const status = Number(error?.status || error?.statusCode) || 500;

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.' });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    if (error?.name === 'MulterError') {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'File exceeds the maximum upload size.'
          : `Upload rejected: ${error.message || 'invalid multipart request'}`;
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    }

    if (status >= 500) {
      console.error(`[api] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    }

    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : error?.message || 'Request failed',
    });
  });

  return app;
}
