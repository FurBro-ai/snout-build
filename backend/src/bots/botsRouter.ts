import crypto from 'crypto';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ALL_PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS, hasPermission } from '../../../shared/constants.ts';
import type { Message } from '../../../shared/types.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { isSafeHttpsUrl, safeHttpsRequest } from '../config/safeHttpsRequest.ts';
import { checkServerPermission } from '../permissions/permissionService.ts';
import { dbStore, type StoredBot, type StoredUser } from '../store/dbStore.ts';
import { emitToChannel } from '../websocket/socketGateway.ts';

export const botsRouter = Router();

function sanitizeBot(bot: StoredBot) {
  const { tokenHash: _th, clientSecretHash: _csh, ...safe } = bot;
  return safe;
}

export function logBotEvent(botId: string, level: 'INFO' | 'WARN' | 'ERROR', event: string, message: string) {
  dbStore.state.botLogs.unshift({
    id: uuidv4(),
    botId,
    level,
    event,
    message,
    createdAt: new Date().toISOString(),
  });
  if (dbStore.state.botLogs.length > 500) {
    dbStore.state.botLogs = dbStore.state.botLogs.slice(0, 500);
  }
  dbStore.save();
}

export async function dispatchSlashCommand(params: {
  serverId: string;
  channelId: string;
  userId: string;
  rawContent: string;
}): Promise<Message | null> {
  const trimmed = params.rawContent.trim();
  if (!trimmed.startsWith('/')) return null;

  const [cmdToken, ...args] = trimmed.slice(1).split(/\s+/);
  const commandName = cmdToken.toLowerCase();
  const argText = args.join(' ');

  const installedBots = dbStore.state.bots.filter((b) =>
    b.installedServerIds.includes(params.serverId)
  );
  const matchingBot = installedBots.find((b) =>
    b.slashCommands.some((c) => c.name.toLowerCase() === commandName)
  );
  if (!matchingBot) return null;

  const commandChannel = dbStore.state.channels.find((channel) => channel.id === params.channelId);
  if (
    !commandChannel ||
    commandChannel.serverId !== params.serverId ||
    !hasPermission(matchingBot.permissions, PERMISSIONS.READ_MESSAGES) ||
    !hasPermission(matchingBot.permissions, PERMISSIONS.SEND_MESSAGES) ||
    !checkServerPermission(params.serverId, matchingBot.botUserId, PERMISSIONS.READ_MESSAGES, commandChannel) ||
    !checkServerPermission(params.serverId, matchingBot.botUserId, PERMISSIONS.SEND_MESSAGES, commandChannel)
  ) {
    logBotEvent(matchingBot.id, 'WARN', 'SLASH_COMMAND_DENIED', `Blocked /${commandName}: missing channel permissions`);
    return null;
  }

  const botUser = dbStore.state.users.find((u) => u.id === matchingBot.botUserId);
  let replyContent = '';

  if (matchingBot.id === 'bot-app-chord-sentinel') {
    const server = dbStore.state.servers.find((s) => s.id === params.serverId);
    const memberCount = dbStore.state.members.filter((m) => m.serverId === params.serverId).length;
    const channelCount = dbStore.state.channels.filter((c) => c.serverId === params.serverId).length;
    const roleCount = dbStore.state.roles.filter((r) => r.serverId === params.serverId).length;

    switch (commandName) {
      case 'help':
        replyContent = [
          '**Snout Sentinel Commands**',
          '`/help` — Show available slash commands',
          '`/ping` — Verify live Socket.IO gateway responsiveness',
          '`/serverinfo` — Display member, role, and channel counts',
          '`/poll <question>` — Post a quick reaction poll',
        ].join('\n');
        break;
      case 'ping':
        replyContent = `Pong — Snout Gateway responded at \`${new Date().toISOString()}\`.`;
        break;
      case 'serverinfo':
        replyContent = `**${server?.name || 'Server'}**\nMembers: **${memberCount}** · Channels: **${channelCount}** · Roles: **${roleCount}**`;
        break;
      case 'poll':
        replyContent = `**Poll:** ${argText || 'Should we ship this feature?'}\nReact with 👍 or 👎 below.`;
        break;
    }
  } else if (matchingBot.webhookUrl) {
    try {
      const requestBody = JSON.stringify({
        type: 'SLASH_COMMAND',
        command: commandName,
        args: argText,
        serverId: params.serverId,
        channelId: params.channelId,
        userId: params.userId,
      });
      const resp = await safeHttpsRequest(matchingBot.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(requestBody)) },
        body: requestBody,
        timeoutMs: 4000,
        maxResponseBytes: 32 * 1024,
      });
      if (resp && resp.statusCode >= 200 && resp.statusCode < 300) {
        let json: { content?: string } = {};
        try {
          json = JSON.parse(resp.body.toString('utf8')) as { content?: string };
        } catch {
          // A successful webhook may acknowledge without a JSON response.
        }
        replyContent = json.content || `Command \`/${commandName}\` acknowledged by ${matchingBot.name}.`;
        logBotEvent(matchingBot.id, 'INFO', 'SLASH_COMMAND', `Executed /${commandName} via webhook (${resp.statusCode})`);
      } else {
        const statusCode = resp?.statusCode;
        logBotEvent(matchingBot.id, 'WARN', 'SLASH_COMMAND', `Webhook ${statusCode ? `returned HTTP ${statusCode}` : 'request was blocked or failed'} for /${commandName}`);
        replyContent = statusCode
          ? `${matchingBot.name} webhook returned HTTP ${statusCode}.`
          : `${matchingBot.name} webhook is unreachable or uses a blocked address.`;
      }
    } catch (err) {
      logBotEvent(matchingBot.id, 'ERROR', 'SLASH_COMMAND', `Webhook dispatch failed: ${(err as Error).message}`);
      replyContent = `${matchingBot.name} endpoint unreachable for \`/${commandName}\`.`;
    }
  } else {
    logBotEvent(matchingBot.id, 'INFO', 'SLASH_COMMAND', `Handled /${commandName} internally`);
    replyContent = `Executed \`/${commandName}\` on **${matchingBot.name}**${argText ? ` with input: \`${argText}\`` : ''}.`;
  }

  if (!replyContent) return null;

  const now = new Date().toISOString();
  const botMsg: Message = {
    id: uuidv4(),
    channelId: params.channelId,
    threadId: null,
    serverId: params.serverId,
    authorId: matchingBot.botUserId,
    author: botUser ? dbStore.toPublicUser(botUser) : undefined,
    content: replyContent,
    replyToId: null,
    attachments: [],
    reactions: commandName === 'poll' ? [{ emoji: '👍', userIds: [] }, { emoji: '👎', userIds: [] }] : [],
    mentions: [],
    linkPreview: null,
    isPinned: false,
    isEdited: false,
    readByIds: [],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.messages.push(botMsg);
  dbStore.save();
  emitToChannel(params.channelId, 'message:new', botMsg);
  return botMsg;
}

const createBotSchema = z.object({
  name: z.string().min(2).max(48),
  description: z.string().max(400).optional(),
  webhookUrl: z.string().url().refine(isSafeHttpsUrl, 'Webhook URL must use HTTPS on port 443 without embedded credentials').nullable().optional(),
  permissions: z.number().optional(),
});

const updateBotSchema = z.object({
  name: z.string().min(2).max(48).optional(),
  description: z.string().max(400).optional(),
  webhookUrl: z.string().url().refine(isSafeHttpsUrl, 'Webhook URL must use HTTPS on port 443 without embedded credentials').nullable().optional(),
  subscribedEvents: z.array(z.string().max(64)).max(32).optional(),
  permissions: z.number().int().nonnegative().max(ALL_PERMISSIONS).optional(),
}).strict();

botsRouter.get('/mine', requireAuth, (req: AuthenticatedRequest, res) => {
  const bots = dbStore.state.bots
    .filter((b) => b.ownerId === req.user!.id)
    .map(sanitizeBot);
  res.json({ bots });
});

botsRouter.get('/server/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  const bots = dbStore.state.bots
    .filter((b) => b.installedServerIds.includes(serverId))
    .map(sanitizeBot);
  res.json({ bots });
});

botsRouter.post('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = createBotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid bot application details', details: parsed.error.flatten() });
  }
  const now = new Date().toISOString();
  const botId = uuidv4();
  const botUserId = `bot-${uuidv4()}`;
  const rawToken = `chrd_bot_${crypto.randomBytes(24).toString('hex')}`;
  const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20);

  const botUser: StoredUser = {
    id: botUserId,
    firebaseUid: null,
    username: `${slug}_bot_${Math.floor(100 + Math.random() * 900)}`,
    discriminator: '0000',
    displayName: parsed.data.name.trim(),
    email: `${botUserId}@bot.snout.internal`,
    passwordHash: null,
    emailVerified: true,
    emailVerificationToken: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    avatarUrl: '/src/assets/images/chord_avatar_bot_1794745770795.jpg',
    animatedAvatarUrl: null,
    bannerUrl: null,
    bio: parsed.data.description?.trim() || 'Snout Developer Bot',
    status: 'online',
    customStatus: '',
    activityStatus: 'Bot Gateway Active',
    profileDecoration: 'none',
    isNitro: false,
    isBot: true,
    isSuspended: false,
    platformRole: 'USER',
    badgeIds: [],
    createdAt: now,
    updatedAt: now,
  };

  const bot: StoredBot = {
    id: botId,
    ownerId: req.user!.id,
    botUserId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || '',
    avatarUrl: '/src/assets/images/chord_avatar_bot_1794745770795.jpg',
    tokenPrefix: rawToken.slice(0, 16),
    tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    clientSecretHash: crypto.createHash('sha256').update(crypto.randomBytes(24)).digest('hex'),
    permissions: parsed.data.permissions ?? DEFAULT_MEMBER_PERMISSIONS,
    webhookUrl: parsed.data.webhookUrl || null,
    subscribedEvents: ['MESSAGE_CREATE', 'SLASH_COMMAND'],
    slashCommands: [],
    installedServerIds: [],
    createdAt: now,
  };

  dbStore.state.users.push(botUser);
  dbStore.state.bots.push(bot);
  logBotEvent(bot.id, 'INFO', 'BOT_CREATED', `Bot application "${bot.name}" registered by ${req.user!.username}`);
  dbStore.save();

  res.status(201).json({
    bot: sanitizeBot(bot),
    botToken: rawToken,
  });
});

botsRouter.post('/:botId/rotate-token', requireAuth, (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId && b.ownerId === req.user!.id);
  if (!bot) return res.status(404).json({ error: 'Bot application not found' });
  const rawToken = `chrd_bot_${crypto.randomBytes(24).toString('hex')}`;
  bot.tokenPrefix = rawToken.slice(0, 16);
  bot.tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  logBotEvent(bot.id, 'WARN', 'TOKEN_ROTATED', 'Bot token regenerated by owner');
  dbStore.save();
  res.json({ bot: sanitizeBot(bot), botToken: rawToken });
});

botsRouter.patch('/:botId', requireAuth, (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId && b.ownerId === req.user!.id);
  if (!bot) return res.status(404).json({ error: 'Bot application not found' });
  const parsed = updateBotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid bot configuration', details: parsed.error.flatten() });
  }
  const { name, description, webhookUrl, subscribedEvents, permissions } = parsed.data;
  if (name !== undefined && name.trim().length >= 2) bot.name = name.trim().slice(0, 48);
  if (description !== undefined) bot.description = description.slice(0, 400);
  if (webhookUrl !== undefined) bot.webhookUrl = webhookUrl;
  if (Array.isArray(subscribedEvents)) bot.subscribedEvents = subscribedEvents.map(String);
  if (permissions !== undefined) bot.permissions = permissions;
  dbStore.save();
  res.json({ bot: sanitizeBot(bot) });
});

botsRouter.post('/:botId/commands', requireAuth, (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId && b.ownerId === req.user!.id);
  if (!bot) return res.status(404).json({ error: 'Bot application not found' });
  const name = String(req.body?.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  const description = String(req.body?.description || 'Custom slash command').slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Valid command name required' });

  bot.slashCommands = bot.slashCommands.filter((c) => c.name !== name);
  bot.slashCommands.push({
    id: uuidv4(),
    botId: bot.id,
    name,
    description,
    options: Array.isArray(req.body?.options) ? req.body.options : [],
  });
  logBotEvent(bot.id, 'INFO', 'COMMAND_REGISTERED', `Registered /${name}`);
  dbStore.save();
  res.status(201).json({ bot: sanitizeBot(bot) });
});

botsRouter.post('/:botId/authorize', requireAuth, (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const serverId = String(req.body?.serverId || '');
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER)) {
    return res.status(403).json({ error: 'MANAGE_SERVER permission required to authorize bots' });
  }
  if (!bot.installedServerIds.includes(serverId)) {
    bot.installedServerIds.push(serverId);
  }
  const alreadyMember = dbStore.state.members.some(
    (m) => m.serverId === serverId && m.userId === bot.botUserId
  );
  if (!alreadyMember) {
    const defaultRole = dbStore.state.roles.find((r) => r.serverId === serverId && r.isDefault);
    dbStore.state.members.push({
      id: uuidv4(),
      serverId,
      userId: bot.botUserId,
      nickname: bot.name,
      roleIds: defaultRole ? [defaultRole.id] : [],
      joinedAt: new Date().toISOString(),
      timeoutUntil: null,
    });
  }
  logBotEvent(bot.id, 'INFO', 'OAUTH2_AUTHORIZED', `Authorized on server ${serverId}`);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'BOT_AUTHORIZED',
    targetType: 'BOT',
    targetId: bot.id,
    details: `Authorized bot "${bot.name}" via OAuth2`,
  });
  dbStore.save();
  res.json({ ok: true, bot: sanitizeBot(bot) });
});

botsRouter.get('/:botId/logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const bot = dbStore.state.bots.find((b) => b.id === req.params.botId && b.ownerId === req.user!.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const logs = dbStore.state.botLogs.filter((l) => l.botId === bot.id).slice(0, 100);
  res.json({ logs });
});

// Bot REST API: Allow third-party bots authenticated via `Bot <token>` to send messages
botsRouter.post('/gateway/channels/:channelId/messages', (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bot ')) {
    return res.status(401).json({ error: 'Authorization: Bot <token> header required' });
  }
  const rawToken = auth.slice(4).trim();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const bot = dbStore.state.bots.find((b) => b.tokenHash === tokenHash);
  if (!bot) return res.status(401).json({ error: 'Invalid bot token' });

  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!bot.installedServerIds.includes(channel.serverId)) {
    return res.status(403).json({ error: 'Bot is not authorized on this server' });
  }
  if (
    !hasPermission(bot.permissions, PERMISSIONS.READ_MESSAGES) ||
    !hasPermission(bot.permissions, PERMISSIONS.SEND_MESSAGES) ||
    !checkServerPermission(channel.serverId, bot.botUserId, PERMISSIONS.READ_MESSAGES, channel) ||
    !checkServerPermission(channel.serverId, bot.botUserId, PERMISSIONS.SEND_MESSAGES, channel)
  ) {
    return res.status(403).json({ error: 'Bot lacks permission to read and send messages in this channel' });
  }

  const content = String(req.body?.content || '').trim();
  if (!content || content.length > 4000) {
    return res.status(400).json({ error: 'Message content (1-4000 chars) required' });
  }

  const botUser = dbStore.state.users.find((u) => u.id === bot.botUserId);
  const now = new Date().toISOString();
  const message: Message = {
    id: uuidv4(),
    channelId: channel.id,
    threadId: null,
    serverId: channel.serverId,
    authorId: bot.botUserId,
    author: botUser ? dbStore.toPublicUser(botUser) : undefined,
    content,
    replyToId: null,
    attachments: [],
    reactions: [],
    mentions: [],
    linkPreview: null,
    isPinned: false,
    isEdited: false,
    readByIds: [],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.messages.push(message);
  logBotEvent(bot.id, 'INFO', 'MESSAGE_SENT', `Sent message to #${channel.name}`);
  dbStore.save();
  emitToChannel(channel.id, 'message:new', message);
  res.status(201).json({ message });
});

// Channel Webhooks Management & Execution
botsRouter.get('/webhooks/server/:serverId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_WEBHOOKS)) {
    return res.status(403).json({ error: 'Missing MANAGE_WEBHOOKS permission' });
  }
  const webhooks = dbStore.state.channelWebhooks.filter((w) => w.serverId === serverId);
  res.json({ webhooks });
});

botsRouter.post('/webhooks/channel/:channelId', requireAuth, (req: AuthenticatedRequest, res) => {
  const channel = dbStore.state.channels.find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!checkServerPermission(channel.serverId, req.user!.id, PERMISSIONS.MANAGE_WEBHOOKS)) {
    return res.status(403).json({ error: 'Missing MANAGE_WEBHOOKS permission' });
  }
  const webhook = {
    id: uuidv4(),
    serverId: channel.serverId,
    channelId: channel.id,
    name: String(req.body?.name || 'Snout Webhook').slice(0, 64),
    avatarUrl: null,
    token: crypto.randomBytes(24).toString('hex'),
    createdBy: req.user!.id,
    createdAt: new Date().toISOString(),
  };
  dbStore.state.channelWebhooks.push(webhook);
  dbStore.save();
  res.status(201).json({ webhook });
});

botsRouter.post('/webhooks/execute/:webhookId/:token', (req, res) => {
  const webhook = dbStore.state.channelWebhooks.find(
    (w) => w.id === req.params.webhookId && w.token === req.params.token
  );
  if (!webhook) return res.status(404).json({ error: 'Invalid webhook URL or token' });

  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Webhook content required' });

  const now = new Date().toISOString();
  const msg: Message = {
    id: uuidv4(),
    channelId: webhook.channelId,
    threadId: null,
    serverId: webhook.serverId,
    authorId: 'bot-user-chord-sentinel',
    author: {
      id: webhook.id,
      username: webhook.name.toLowerCase().replace(/\s+/g, '_'),
      discriminator: '0000',
      displayName: `${webhook.name} [Webhook]`,
      avatarUrl: '/src/assets/images/chord_avatar_bot_1794745770795.jpg',
      animatedAvatarUrl: null,
      bannerUrl: null,
      bio: 'Incoming Channel Webhook',
      status: 'online',
      customStatus: '',
      activityStatus: '',
      profileDecoration: 'none',
      isNitro: false,
      isBot: true,
      platformRole: 'USER',
      emailVerified: true,
      twoFactorEnabled: false,
      badgeIds: [],
      createdAt: now,
    },
    content: content.slice(0, 4000),
    replyToId: null,
    attachments: [],
    reactions: [],
    mentions: [],
    linkPreview: null,
    isPinned: false,
    isEdited: false,
    readByIds: [],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.messages.push(msg);
  dbStore.save();
  emitToChannel(webhook.channelId, 'message:new', msg);
  res.status(201).json({ ok: true, message: msg });
});
