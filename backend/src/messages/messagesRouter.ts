import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { NITRO_PLAN, PERMISSIONS } from '../../../shared/constants.ts';
import type { LinkPreview, Message, MessageAttachment } from '../../../shared/types.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dispatchSlashCommand } from '../bots/botsRouter.ts';
import { UPLOADS_DIR, ensureUploadsDir } from '../config/uploads.ts';
import { checkServerPermission, getMember, isMemberTimedOut } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToChannel, emitToThread, emitToUser } from '../websocket/socketGateway.ts';

export const messagesRouter = Router();

ensureUploadsDir();

// Only keep a short, safe extension on disk. The original filename is kept in
// the attachment record so downloads still show what the member uploaded.
const SAFE_EXTENSION = /^\.[a-z0-9]{1,12}$/;

function sanitizeExtension(originalName: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  return SAFE_EXTENSION.test(ext) ? ext : '';
}

function sanitizeOriginalFilename(originalName: string): string {
  const base = path.basename((originalName || '').replace(/\\/g, '/')).trim();
  return (base || 'upload').slice(0, 255);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${sanitizeExtension(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: NITRO_PLAN.maxUploadBytesNitro },
});

function uploadSingleFile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: req.user?.isNitro
          ? 'File exceeds the 100 MB Nitro upload limit.'
          : 'File exceeds the 10 MB standard upload limit. Upgrade to SNOUT NITRO ($2.00/month) for 100 MB uploads.',
      });
    }

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field. Upload a single file using the "file" field.'
          : `Upload rejected: ${err.message}`;
      return res.status(400).json({ error: message, code: err.code });
    }

    const message = err instanceof Error ? err.message : 'Unknown upload error';
    return res.status(400).json({ error: `Upload failed: ${message}` });
  });
}

function hydrateMessage(m: Message): Message {
  const storedAuthor = dbStore.state.users.find((u) => u.id === m.authorId);
  const publicAuthor = storedAuthor ? dbStore.toPublicUser(storedAuthor) : m.author;
  let replyToMessage = m.replyToMessage || null;
  if (m.replyToId && !replyToMessage) {
    const parent = dbStore.state.messages.find((pm) => pm.id === m.replyToId);
    if (parent) {
      const parentAuthor = dbStore.state.users.find((u) => u.id === parent.authorId);
      replyToMessage = {
        id: parent.id,
        authorName: parentAuthor?.displayName || 'Unknown',
        content: parent.content.slice(0, 120),
      };
    }
  }
  return {
    ...m,
    author: publicAuthor,
    replyToMessage,
  };
}

async function extractLinkPreview(content: string): Promise<LinkPreview | null> {
  const match = content.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const url = match[0];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return {
      url,
      title: parsed.hostname.slice(0, 140),
      description: `Link shared in Snout: ${url}`.slice(0, 240),
      domain: parsed.hostname,
    };
  } catch {
    return null;
  }
}

function parseMentions(content: string, actorName: string, linkUrl: string): string[] {
  const matches = Array.from(content.matchAll(/@([a-zA-Z0-9_.\-]+)/g)).map((m) => m[1].toLowerCase());
  const mentionedIds: string[] = [];
  for (const uname of matches) {
    const user = dbStore.state.users.find((u) => u.username.toLowerCase() === uname);
    if (user && !mentionedIds.includes(user.id)) {
      mentionedIds.push(user.id);
      const notif = dbStore.addNotification({
        userId: user.id,
        type: 'MENTION',
        title: `Mentioned by ${actorName}`,
        body: content.slice(0, 140),
        linkUrl,
      });
      emitToUser(user.id, 'notification:new', notif);
    }
  }
  return mentionedIds;
}

// File & Voice Message Upload (enforces 10 MB free vs 100 MB SNOUT NITRO)
messagesRouter.post('/upload', requireAuth, uploadSingleFile, (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  if (!file.size) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ error: 'Empty files cannot be uploaded.' });
  }
  const maxBytes = req.user!.isNitro ? NITRO_PLAN.maxUploadBytesNitro : NITRO_PLAN.maxUploadBytesFree;
  if (file.size > maxBytes) {
    fs.unlink(file.path, () => {});
    return res.status(413).json({
      error: req.user!.isNitro
        ? 'File exceeds the 100 MB Nitro upload limit.'
        : 'File exceeds the 10 MB standard upload limit. Upgrade to SNOUT NITRO ($2.00/month) for 100 MB uploads.',
    });
  }
  const attachment: MessageAttachment = {
    id: uuidv4(),
    filename: sanitizeOriginalFilename(file.originalname),
    mimeType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size,
    url: `/uploads/${file.filename}`,
    isVoiceMessage: req.body?.isVoiceMessage === 'true',
    durationSec: req.body?.durationSec ? Number(req.body.durationSec) : undefined,
  };
  res.status(201).json({ attachment });
});

// Direct Messages & Group DMs
messagesRouter.get('/dms', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const threads = dbStore.state.directThreads
    .filter((t) => t.participantIds.includes(userId))
    .map((t) => ({
      ...t,
      participants: t.participantIds
        .map((pid) => dbStore.state.users.find((u) => u.id === pid))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => dbStore.toPublicUser(u)),
    }))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  res.json({ threads });
});

messagesRouter.post('/dms', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const participantIds = Array.isArray(req.body?.participantIds)
    ? Array.from(new Set([userId, ...req.body.participantIds.map(String)]))
    : [];

  if (participantIds.length < 2) {
    return res.status(400).json({ error: 'At least one other participant is required' });
  }

  const isGroup = participantIds.length > 2 || Boolean(req.body?.isGroup);
  if (!isGroup) {
    const existing = dbStore.state.directThreads.find(
      (t) =>
        !t.isGroup &&
        t.participantIds.length === 2 &&
        participantIds.every((id) => t.participantIds.includes(id))
    );
    if (existing) {
      return res.json({
        thread: {
          ...existing,
          participants: existing.participantIds
            .map((pid) => dbStore.state.users.find((u) => u.id === pid))
            .filter((u): u is NonNullable<typeof u> => Boolean(u))
            .map((u) => dbStore.toPublicUser(u)),
        },
      });
    }
  }

  const thread = {
    id: uuidv4(),
    isGroup,
    name: isGroup ? String(req.body?.name || 'Group Direct Message').slice(0, 64) : null,
    ownerId: isGroup ? userId : null,
    participantIds,
    participants: [],
    lastMessageAt: new Date().toISOString(),
  };
  dbStore.state.directThreads.push(thread);
  dbStore.save();

  const hydrated = {
    ...thread,
    participants: thread.participantIds
      .map((pid) => dbStore.state.users.find((u) => u.id === pid))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => dbStore.toPublicUser(u)),
  };
  for (const pid of participantIds) {
    emitToUser(pid, 'dm:thread', hydrated);
  }
  res.status(201).json({ thread: hydrated });
});

messagesRouter.get('/dms/:threadId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const thread = dbStore.state.directThreads.find((t) => t.id === req.params.threadId);
  if (!thread || !thread.participantIds.includes(req.user!.id)) {
    return res.status(403).json({ error: 'Access denied to DM thread' });
  }
  const q = String(req.query.q || '').toLowerCase().trim();
  const messages = dbStore.state.messages
    .filter((m) => m.threadId === thread.id && (!q || m.content.toLowerCase().includes(q)))
    .map(hydrateMessage);
  res.json({ messages });
});

messagesRouter.post('/dms/:threadId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  const thread = dbStore.state.directThreads.find((t) => t.id === req.params.threadId);
  if (!thread || !thread.participantIds.includes(req.user!.id)) {
    return res.status(403).json({ error: 'Access denied to DM thread' });
  }
  const content = String(req.body?.content || '').trim();
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!content && attachments.length === 0) {
    return res.status(400).json({ error: 'Message content or attachment required' });
  }

  // Check blocks
  const otherIds = thread.participantIds.filter((id) => id !== req.user!.id);
  const blocked = !thread.isGroup && dbStore.state.blocks.some(
    (b) =>
      (b.blockerId === otherIds[0] && b.blockedId === req.user!.id) ||
      (b.blockerId === req.user!.id && b.blockedId === otherIds[0])
  );
  if (blocked) {
    return res.status(403).json({ error: 'Cannot message a blocked user' });
  }

  const now = new Date().toISOString();
  const linkPreview = content ? await extractLinkPreview(content) : null;
  const mentions = content ? parseMentions(content, req.user!.displayName, `/dms/${thread.id}`) : [];

  const msg: Message = {
    id: uuidv4(),
    channelId: null,
    threadId: thread.id,
    serverId: null,
    authorId: req.user!.id,
    content: content.slice(0, 4000),
    replyToId: req.body?.replyToId || null,
    attachments,
    reactions: [],
    mentions,
    linkPreview,
    isPinned: false,
    isEdited: false,
    readByIds: [req.user!.id],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.messages.push(msg);
  thread.lastMessageAt = now;
  dbStore.save();

  const hydrated = hydrateMessage(msg);
  emitToThread(thread.id, 'message:new', hydrated);
  for (const pid of otherIds) {
    emitToUser(pid, 'message:dm-notify', hydrated);
  }
  res.status(201).json({ message: hydrated });
});

// Channel Messages
messagesRouter.get('/channels/:channelId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.READ_MESSAGES, channel)) {
    return res.status(403).json({ error: 'Missing READ_MESSAGES permission' });
  }
  const q = String(req.query.q || '').toLowerCase().trim();
  const messages = dbStore.state.messages
    .filter((m) => m.channelId === channel.id && (!q || m.content.toLowerCase().includes(q)))
    .map(hydrateMessage);
  res.json({ messages });
});

messagesRouter.post('/channels/:channelId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const member = getMember(channel.serverId, req.user!.id);
  if (!member) return res.status(403).json({ error: 'Not a server member' });
  if (isMemberTimedOut(member)) {
    return res.status(403).json({ error: 'You are currently timed out in this server' });
  }
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.SEND_MESSAGES, channel)) {
    return res.status(403).json({ error: 'Missing SEND_MESSAGES permission' });
  }

  const content = String(req.body?.content || '').trim();
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!content && attachments.length === 0) {
    return res.status(400).json({ error: 'Message content or attachment required' });
  }

  const now = new Date().toISOString();
  const linkPreview = content ? await extractLinkPreview(content) : null;
  const mentions = content
    ? parseMentions(content, req.user!.displayName, `/servers/${channel.serverId}/${channel.id}`)
    : [];

  const msg: Message = {
    id: uuidv4(),
    channelId: channel.id,
    threadId: null,
    serverId: channel.serverId,
    authorId: req.user!.id,
    content: content.slice(0, 4000),
    replyToId: req.body?.replyToId || null,
    attachments,
    reactions: [],
    mentions,
    linkPreview,
    isPinned: false,
    isEdited: false,
    isForumPost: channel.type === 'FORUM' && Boolean(req.body?.forumTitle),
    forumTitle: req.body?.forumTitle ? String(req.body.forumTitle).slice(0, 140) : null,
    readByIds: [req.user!.id],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.messages.push(msg);
  dbStore.save();

  const hydrated = hydrateMessage(msg);
  emitToChannel(channel.id, 'message:new', hydrated);

  // Trigger slash commands if applicable
  if (content.startsWith('/')) {
    await dispatchSlashCommand({
      serverId: channel.serverId,
      channelId: channel.id,
      userId: req.user!.id,
      rawContent: content,
    });
  }

  res.status(201).json({ message: hydrated });
});

messagesRouter.patch('/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const msg = dbStore.state.messages.find((m) => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.authorId !== req.user!.id) {
    return res.status(403).json({ error: 'Only the author can edit this message' });
  }
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Content cannot be empty' });

  msg.content = content.slice(0, 4000);
  msg.isEdited = true;
  msg.updatedAt = new Date().toISOString();
  dbStore.save();

  const hydrated = hydrateMessage(msg);
  if (msg.channelId) emitToChannel(msg.channelId, 'message:update', hydrated);
  if (msg.threadId) emitToThread(msg.threadId, 'message:update', hydrated);
  res.json({ message: hydrated });
});

messagesRouter.delete('/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const msg = dbStore.state.messages.find((m) => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const canManage =
    msg.serverId && checkServerPermission(msg.serverId, req.user!.id, PERMISSIONS.MANAGE_MESSAGES);
  if (msg.authorId !== req.user!.id && !canManage && req.user!.platformRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Missing permission to delete this message' });
  }

  dbStore.state.messages = dbStore.state.messages.filter((m) => m.id !== msg.id);
  dbStore.save();
  if (msg.channelId) emitToChannel(msg.channelId, 'message:delete', { messageId: msg.id, channelId: msg.channelId });
  if (msg.threadId) emitToThread(msg.threadId, 'message:delete', { messageId: msg.id, threadId: msg.threadId });
  res.json({ ok: true });
});

messagesRouter.post('/messages/:messageId/pin', requireAuth, (req: AuthenticatedRequest, res) => {
  const msg = dbStore.state.messages.find((m) => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.serverId && !checkServerPermission(msg.serverId, req.user!.id, PERMISSIONS.PIN_MESSAGES)) {
    return res.status(403).json({ error: 'Missing PIN_MESSAGES permission' });
  }
  msg.isPinned = !msg.isPinned;
  msg.updatedAt = new Date().toISOString();
  dbStore.save();
  const hydrated = hydrateMessage(msg);
  if (msg.channelId) emitToChannel(msg.channelId, 'message:update', hydrated);
  if (msg.threadId) emitToThread(msg.threadId, 'message:update', hydrated);
  res.json({ message: hydrated });
});

messagesRouter.post('/messages/:messageId/reactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const msg = dbStore.state.messages.find((m) => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const emoji = String(req.body?.emoji || '').trim().slice(0, 32);
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });

  let reaction = msg.reactions.find((r) => r.emoji === emoji);
  if (!reaction) {
    reaction = { emoji, userIds: [req.user!.id] };
    msg.reactions.push(reaction);
  } else if (reaction.userIds.includes(req.user!.id)) {
    reaction.userIds = reaction.userIds.filter((id) => id !== req.user!.id);
    if (reaction.userIds.length === 0) {
      msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
    }
  } else {
    reaction.userIds.push(req.user!.id);
  }

  dbStore.save();
  const hydrated = hydrateMessage(msg);
  if (msg.channelId) emitToChannel(msg.channelId, 'message:update', hydrated);
  if (msg.threadId) emitToThread(msg.threadId, 'message:update', hydrated);
  res.json({ message: hydrated });
});

messagesRouter.post('/messages/:messageId/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const msg = dbStore.state.messages.find((m) => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!msg.readByIds.includes(req.user!.id)) {
    msg.readByIds.push(req.user!.id);
    dbStore.save();
    const hydrated = hydrateMessage(msg);
    if (msg.channelId) emitToChannel(msg.channelId, 'message:update', hydrated);
    if (msg.threadId) emitToThread(msg.threadId, 'message:update', hydrated);
  }
  res.json({ ok: true });
});
