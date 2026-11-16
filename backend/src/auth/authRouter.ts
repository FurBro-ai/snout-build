import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ENV } from '../config/env.ts';
import { dbStore, type StoredUser } from '../store/dbStore.ts';
import { disconnectSessionSockets } from '../websocket/socketGateway.ts';
import {
  type AuthenticatedRequest,
  hashPassword,
  hashToken,
  requireAuth,
  signSessionToken,
  verifyPassword,
} from './authMiddleware.ts';
import {
  buildOtpAuthUri,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  verifyTotpCode,
} from './totp.ts';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.\-]+$/),
  displayName: z.string().min(1).max(64).optional(),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().optional(),
  identifier: z.string().optional(),
  password: z.string().optional(),
  challengeToken: z.string().optional(),
  totpCode: z.string().optional(),
  backupCode: z.string().optional(),
});

const deleteAccountSchema = z.object({
  password: z.string().max(128).optional(),
  totpCode: z.string().max(64).optional(),
  confirmUsername: z.string().max(64),
  confirmation: z.string().max(64),
});

function createUserSession(user: StoredUser, userAgent: string, ipAddress: string) {
  const sessionId = uuidv4();
  const token = signSessionToken(user, sessionId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  dbStore.state.sessions.push({
    id: sessionId,
    userId: user.id,
    tokenHash: hashToken(token),
    userAgent: userAgent || 'Snout Web Client',
    ipAddress: ipAddress || 'unknown',
    lastActiveAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });
  dbStore.save();
  return { token, sessionId };
}

function autoJoinHub(userId: string) {
  const hub = dbStore.state.servers.find((s) => s.id === 'server-chord-hub');
  if (!hub) return;
  const exists = dbStore.state.members.some((m) => m.serverId === hub.id && m.userId === userId);
  if (!exists) {
    dbStore.state.members.push({
      id: uuidv4(),
      serverId: hub.id,
      userId,
      nickname: null,
      roleIds: ['role-hub-everyone'],
      joinedAt: new Date().toISOString(),
      timeoutUntil: null,
    });
  }
}

function generateDiscriminator(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function signTwoFactorChallenge(userId: string): string {
  return jwt.sign({ purpose: '2fa_challenge', userId }, ENV.JWT_SECRET, { expiresIn: '5m' });
}

function verifyTwoFactorChallenge(token: string): string | null {
  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as { purpose?: string; userId?: string };
    if (decoded.purpose !== '2fa_challenge' || !decoded.userId) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

authRouter.post('/register', (req, res) => {
  if (!dbStore.state.platformConfig.registrationEnabled) {
    return res.status(403).json({ error: 'New registrations are currently disabled by platform administrators.' });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid registration details', details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const username = parsed.data.username.trim();
  if (dbStore.state.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  if (dbStore.state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'This username is already taken.' });
  }

  const now = new Date().toISOString();
  const verificationToken = crypto.randomBytes(24).toString('hex');
  const newUser: StoredUser = {
    id: uuidv4(),
    firebaseUid: null,
    username,
    discriminator: generateDiscriminator(),
    displayName: parsed.data.displayName?.trim() || username,
    email,
    passwordHash: hashPassword(parsed.data.password),
    emailVerified: false,
    emailVerificationToken: verificationToken,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorPendingSecret: null,
    twoFactorBackupHashes: [],
    avatarUrl: null,
    animatedAvatarUrl: null,
    bannerUrl: null,
    bio: '',
    status: 'online',
    customStatus: '',
    activityStatus: '',
    profileDecoration: 'none',
    isNitro: false,
    isBot: false,
    isSuspended: false,
    platformRole: 'USER',
    badgeIds: [],
    createdAt: now,
    updatedAt: now,
  };

  dbStore.state.users.push(newUser);
  autoJoinHub(newUser.id);
  const { token } = createUserSession(
    newUser,
    String(req.headers['user-agent'] || 'Web'),
    String(req.ip || '0.0.0.0')
  );
  dbStore.addAuditLog({
    serverId: null,
    actorId: newUser.id,
    action: 'USER_REGISTERED',
    targetType: 'USER',
    targetId: newUser.id,
    details: `Registered account ${newUser.username}`,
  });
  dbStore.save();

  res.status(201).json({
    token,
    user: dbStore.toPublicUser(newUser),
    email: newUser.email,
    verificationToken,
  });
});

authRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid login credentials' });
  }

  const { email, identifier, password, challengeToken, totpCode, backupCode } = parsed.data;
  let user: StoredUser | undefined;

  if (challengeToken) {
    const challengedUserId = verifyTwoFactorChallenge(challengeToken);
    if (!challengedUserId) {
      return res.status(401).json({ error: 'Two-factor session expired. Please sign in again.' });
    }
    user = dbStore.state.users.find((u) => u.id === challengedUserId && !u.isBot);
    if (!user) {
      return res.status(401).json({ error: 'Account not found' });
    }
  } else {
    const rawLookup = (identifier || email || '').trim().toLowerCase();
    if (!rawLookup || !password) {
      return res.status(400).json({ error: 'Email or username and password are required' });
    }
    const lookupCandidates = [rawLookup];
    if (rawLookup.startsWith('@')) lookupCandidates.push(rawLookup.slice(1));
    if (rawLookup.endsWith('.')) lookupCandidates.push(rawLookup.slice(0, -1));
    const uniqueCandidates = [...new Set(lookupCandidates)];
    user = uniqueCandidates
      .map((candidate) => dbStore.state.users.find(
        (u) => !u.isBot && (u.email === candidate || u.username.toLowerCase() === candidate)
      ))
      .find((candidate): candidate is StoredUser => Boolean(candidate));
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  }

  if (user.isSuspended) {
    return res.status(403).json({ error: 'This account has been suspended by moderation.' });
  }

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const providedCode = (totpCode || '').trim();
    const providedBackup = (backupCode || '').trim();

    if (!providedCode && !providedBackup) {
      return res.status(200).json({
        requiresTwoFactor: true,
        challengeToken: signTwoFactorChallenge(user.id),
        username: user.username,
      });
    }

    let verified = false;
    if (providedCode && verifyTotpCode(user.twoFactorSecret, providedCode)) {
      verified = true;
    } else if (providedBackup || (providedCode && !/^\d{6}$/.test(providedCode.replace(/[\s-]+/g, '')))) {
      const candidate = providedBackup || providedCode;
      const result = consumeBackupCode(user.twoFactorBackupHashes, candidate);
      if (result.valid) {
        user.twoFactorBackupHashes = result.nextHashes;
        verified = true;
        dbStore.addAuditLog({
          serverId: null,
          actorId: user.id,
          action: 'USER_2FA_BACKUP_USED',
          targetType: 'USER',
          targetId: user.id,
          details: `Used a single-use 2FA recovery code (${result.nextHashes.length} remaining)`,
        });
      }
    }

    if (!verified) {
      return res.status(401).json({ error: 'Invalid authenticator or recovery code' });
    }
  }

  user.status = user.status === 'offline' ? 'online' : user.status;
  user.updatedAt = new Date().toISOString();
  const { token } = createUserSession(
    user,
    String(req.headers['user-agent'] || 'Web'),
    String(req.ip || '0.0.0.0')
  );
  dbStore.addAuditLog({
    serverId: null,
    actorId: user.id,
    action: 'USER_LOGIN',
    targetType: 'USER',
    targetId: user.id,
    details: `Successful sign-in from IP ${String(req.ip || 'unknown').slice(0, 64)}`,
  });
  dbStore.save();

  res.json({
    token,
    user: dbStore.toPublicUser(user),
    email: user.email,
  });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const sub = dbStore.state.subscriptions.find((s) => s.userId === user.id);
  res.json({
    user: dbStore.toPublicUser(user),
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    subscription: sub || null,
  });
});

authRouter.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.id !== req.sessionId);
  dbStore.save();
  if (req.sessionId) disconnectSessionSockets(req.sessionId, { reason: 'Signed out' });
  res.json({ ok: true });
});

authRouter.post('/verify-email', (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: 'Verification token required' });
  const user = dbStore.state.users.find((u) => u.emailVerificationToken === token);
  if (!user) return res.status(404).json({ error: 'Invalid or expired verification token' });
  user.emailVerified = true;
  user.emailVerificationToken = null;
  user.updatedAt = new Date().toISOString();
  dbStore.save();
  res.json({ ok: true, user: dbStore.toPublicUser(user) });
});

authRouter.post('/resend-verification', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  user.emailVerificationToken = crypto.randomBytes(24).toString('hex');
  dbStore.save();
  res.json({ ok: true, verificationToken: user.emailVerificationToken });
});

authRouter.post('/forgot-password', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({
      error: 'Password recovery is unavailable until email delivery is configured. Contact support.',
    });
  }

  const email = String(req.body?.email || '').toLowerCase().trim();
  const user = dbStore.state.users.find((u) => u.email === email && !u.isBot);
  if (!user) {
    return res.json({ ok: true, message: 'If an account matches that email, a reset token has been generated.' });
  }
  const resetToken = crypto.randomBytes(24).toString('hex');
  user.passwordResetToken = resetToken;
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  dbStore.save();
  res.json({
    ok: true,
    resetToken,
    message: 'Password reset token issued (valid for 1 hour).',
  });
});

authRouter.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Valid reset token and password (min 8 chars) required' });
  }
  const user = dbStore.state.users.find(
    (u) =>
      u.passwordResetToken === token &&
      u.passwordResetExpiresAt &&
      new Date(u.passwordResetExpiresAt).getTime() > Date.now()
  );
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }
  user.passwordHash = hashPassword(newPassword);
  user.passwordResetToken = null;
  user.passwordResetExpiresAt = null;
  user.updatedAt = new Date().toISOString();
  const revokedSessionIds = dbStore.state.sessions.filter((session) => session.userId === user.id).map((session) => session.id);
  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.userId !== user.id);
  dbStore.save();
  for (const sessionId of revokedSessionIds) disconnectSessionSockets(sessionId, { reason: 'Password changed' });
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (user.passwordHash && (!currentPassword || !verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  user.passwordHash = hashPassword(newPassword);
  user.updatedAt = new Date().toISOString();
  const revokedSessionIds = dbStore.state.sessions
    .filter((session) => session.userId === user.id && session.id !== req.sessionId)
    .map((session) => session.id);
  dbStore.state.sessions = dbStore.state.sessions.filter(
    (session) => session.userId !== user.id || session.id === req.sessionId
  );
  dbStore.save();
  for (const sessionId of revokedSessionIds) disconnectSessionSockets(sessionId, { reason: 'Password changed' });
  res.json({ ok: true });
});

authRouter.get('/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessions = dbStore.state.sessions
    .filter((s) => s.userId === req.user!.id)
    .map(({ tokenHash: _th, ...rest }) => ({
      ...rest,
      current: rest.id === req.sessionId,
    }));
  res.json({ sessions });
});

authRouter.delete('/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res) => {
  const target = dbStore.state.sessions.find(
    (s) => s.id === req.params.sessionId && s.userId === req.user!.id
  );
  if (!target) return res.status(404).json({ error: 'Session not found' });
  dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.id !== target.id);
  dbStore.save();
  disconnectSessionSockets(target.id, { sessionId: target.id, reason: 'Session revoked' });
  res.json({ ok: true });
});

authRouter.post('/2fa/setup', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const secret = generateTotpSecret();
  user.twoFactorPendingSecret = secret;
  dbStore.save();

  const accountLabel = `${user.username} (${user.email})`;
  const otpauthUri = buildOtpAuthUri(accountLabel, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
    width: 220,
    margin: 2,
    color: { dark: '#0D0F12', light: '#FFFFFF' },
  });

  res.json({
    secret,
    otpauthUri,
    qrDataUrl,
  });
});

authRouter.post('/2fa/enable', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { code } = req.body as { code?: string };
  const candidateSecret = user.twoFactorPendingSecret || user.twoFactorSecret;
  if (!candidateSecret || !code || !verifyTotpCode(candidateSecret, code)) {
    return res.status(400).json({ error: 'Invalid 6-digit verification code' });
  }

  const { plainCodes, hashes } = generateBackupCodes(8);
  user.twoFactorSecret = candidateSecret;
  user.twoFactorPendingSecret = null;
  user.twoFactorEnabled = true;
  user.twoFactorBackupHashes = hashes;
  user.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: user.id,
    action: 'USER_2FA_ENABLED',
    targetType: 'USER',
    targetId: user.id,
    details: `${user.username} enabled TOTP two-factor authentication`,
  });
  dbStore.save();

  res.json({
    ok: true,
    user: dbStore.toPublicUser(user),
    backupCodes: plainCodes,
  });
});

authRouter.post('/2fa/backup-codes/regenerate', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { code } = req.body as { code?: string };
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: 'Two-factor authentication is not enabled on this account' });
  }
  if (!code || !verifyTotpCode(user.twoFactorSecret, code)) {
    return res.status(400).json({ error: 'Valid 6-digit authenticator code required' });
  }

  const { plainCodes, hashes } = generateBackupCodes(8);
  user.twoFactorBackupHashes = hashes;
  user.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: user.id,
    action: 'USER_2FA_BACKUP_REGENERATED',
    targetType: 'USER',
    targetId: user.id,
    details: `${user.username} regenerated 2FA recovery backup codes`,
  });
  dbStore.save();

  res.json({
    ok: true,
    user: dbStore.toPublicUser(user),
    backupCodes: plainCodes,
  });
});

authRouter.post('/2fa/disable', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { code } = req.body as { code?: string };
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const raw = (code || '').trim();
    const validTotp = raw ? verifyTotpCode(user.twoFactorSecret, raw) : false;
    const validBackup = !validTotp && raw ? consumeBackupCode(user.twoFactorBackupHashes, raw).valid : false;
    if (!validTotp && !validBackup) {
      return res.status(400).json({ error: 'Valid 6-digit 2FA code or recovery backup code required' });
    }
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.twoFactorPendingSecret = null;
  user.twoFactorBackupHashes = [];
  user.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: user.id,
    action: 'USER_2FA_DISABLED',
    targetType: 'USER',
    targetId: user.id,
    details: `${user.username} disabled TOTP two-factor authentication`,
  });
  dbStore.save();

  res.json({ ok: true, user: dbStore.toPublicUser(user) });
});

authRouter.delete('/account', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const parsed = deleteAccountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Account deletion requires confirmUsername and confirmation ("DELETE MY ACCOUNT").',
      details: parsed.error.flatten(),
    });
  }

  const { password, totpCode, confirmUsername, confirmation } = parsed.data;
  const userId = user.id;

  if (confirmUsername !== user.username) {
    return res.status(400).json({ error: `Username confirmation does not match @${user.username}.` });
  }
  if (confirmation !== 'DELETE MY ACCOUNT') {
    return res.status(400).json({ error: 'Confirmation phrase must be exactly "DELETE MY ACCOUNT".' });
  }

  if (user.passwordHash) {
    if (!password) {
      return res.status(400).json({ error: 'Your current password is required to delete this account.' });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
  }

  if (user.twoFactorEnabled) {
    const rawCode = (totpCode || '').trim();
    if (!rawCode) {
      return res.status(400).json({ error: 'A 6-digit authenticator code or recovery backup code is required.' });
    }
    let verified = false;
    if (user.twoFactorSecret && /^\d{6}$/.test(rawCode.replace(/[\s-]+/g, ''))) {
      verified = verifyTotpCode(user.twoFactorSecret, rawCode);
    }
    if (!verified) {
      const backup = consumeBackupCode(user.twoFactorBackupHashes, rawCode);
      if (backup.valid) {
        user.twoFactorBackupHashes = backup.nextHashes;
        verified = true;
      }
    }
    if (!verified) {
      return res.status(400).json({ error: 'Invalid authenticator or recovery code.' });
    }
  }

  if (!user.passwordHash && !user.twoFactorEnabled) {
    const session = dbStore.state.sessions.find(
      (candidate) => candidate.id === req.sessionId && candidate.userId === userId
    );
    const signedInAt = session ? Date.parse(session.createdAt) : Number.NaN;
    if (!Number.isFinite(signedInAt) || Date.now() - signedInAt > 10 * 60 * 1000 || signedInAt > Date.now()) {
      return res.status(401).json({
        error: 'For security, sign in again within the last 10 minutes before deleting this passwordless account.',
      });
    }
  }

  // Servers owned by this account can only be removed automatically when no
  // other members would lose their workspace.
  const ownedServers = dbStore.state.servers.filter((s) => s.ownerId === userId);
  const blockedServers = ownedServers.filter((server) =>
    dbStore.state.members.some((m) => m.serverId === server.id && m.userId !== userId)
  );
  if (blockedServers.length > 0) {
    return res.status(409).json({
      error:
        'You own servers that still have other members. Transfer ownership or delete those servers before deleting your account.',
      ownedServers: blockedServers.map((server) => ({ id: server.id, name: server.name })),
    });
  }

  const ownedServerIds = new Set(ownedServers.map((server) => server.id));
  const serverChannelIds = new Set(
    dbStore.state.channels.filter((channel) => ownedServerIds.has(channel.serverId)).map((channel) => channel.id)
  );

  // Bots owned by this account are deleted with it (otherwise they become
  // orphaned rows that nobody can manage).
  const ownedBots = dbStore.state.bots.filter((bot) => bot.ownerId === userId);
  const ownedBotIds = new Set(ownedBots.map((bot) => bot.id));
  const removedUserIds = new Set<string>([userId, ...ownedBots.map((bot) => bot.botUserId)]);

  if (ownedServerIds.size > 0) {
    dbStore.state.servers = dbStore.state.servers.filter((server) => !ownedServerIds.has(server.id));
    dbStore.state.categories = dbStore.state.categories.filter((cat) => !ownedServerIds.has(cat.serverId));
    dbStore.state.channels = dbStore.state.channels.filter((channel) => !ownedServerIds.has(channel.serverId));
    dbStore.state.roles = dbStore.state.roles.filter((role) => !ownedServerIds.has(role.serverId));
    dbStore.state.members = dbStore.state.members.filter((member) => !ownedServerIds.has(member.serverId));
    dbStore.state.invites = dbStore.state.invites.filter((invite) => !ownedServerIds.has(invite.serverId));
    dbStore.state.bans = dbStore.state.bans.filter((ban) => !ownedServerIds.has(ban.serverId));
    dbStore.state.channelWebhooks = dbStore.state.channelWebhooks.filter(
      (webhook) => !ownedServerIds.has(webhook.serverId)
    );
    dbStore.state.serverDatabases = dbStore.state.serverDatabases.filter(
      (table) => !ownedServerIds.has(table.serverId)
    );
    dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter(
      (row) => !ownedServerIds.has(row.serverId)
    );
    dbStore.state.scheduledEvents = dbStore.state.scheduledEvents.filter(
      (event) => !ownedServerIds.has(event.serverId)
    );
    for (const bot of dbStore.state.bots) {
      bot.installedServerIds = bot.installedServerIds.filter((id) => !ownedServerIds.has(id));
    }
  }

  if (ownedBotIds.size > 0) {
    dbStore.state.bots = dbStore.state.bots.filter((bot) => !ownedBotIds.has(bot.id));
    dbStore.state.botLogs = dbStore.state.botLogs.filter((log) => !ownedBotIds.has(log.botId));
  }

  // Drop direct-thread participation; threads that can no longer hold a
  // conversation are deleted along with their messages.
  const removedThreadIds = new Set<string>();
  dbStore.state.directThreads = dbStore.state.directThreads.filter((thread) => {
    const remaining = thread.participantIds.filter((id) => !removedUserIds.has(id));
    thread.participantIds = remaining;
    if (Array.isArray(thread.participants)) {
      thread.participants = thread.participants.filter((participant) => !removedUserIds.has(participant.id));
    }
    if (thread.ownerId && removedUserIds.has(thread.ownerId)) {
      thread.ownerId = remaining[0] || null;
    }
    if (remaining.length >= 2) return true;
    removedThreadIds.add(thread.id);
    return false;
  });

  dbStore.state.messages = dbStore.state.messages.filter((message) => {
    if (removedUserIds.has(message.authorId)) return false;
    if (message.threadId && removedThreadIds.has(message.threadId)) return false;
    if (message.serverId && ownedServerIds.has(message.serverId)) return false;
    if (message.channelId && serverChannelIds.has(message.channelId)) return false;
    return true;
  });
  for (const message of dbStore.state.messages) {
    message.reactions = (message.reactions || []).filter((reaction) => {
      reaction.userIds = reaction.userIds.filter((id) => !removedUserIds.has(id));
      return reaction.userIds.length > 0;
    });
    message.readByIds = (message.readByIds || []).filter((id) => !removedUserIds.has(id));
    message.mentions = (message.mentions || []).filter((id) => !removedUserIds.has(id));
  }

  dbStore.state.sessions = dbStore.state.sessions.filter((session) => !removedUserIds.has(session.userId));
  dbStore.state.friends = dbStore.state.friends.filter(
    (friend) => !removedUserIds.has(friend.userAId) && !removedUserIds.has(friend.userBId)
  );
  dbStore.state.friendRequests = dbStore.state.friendRequests.filter(
    (request) => !removedUserIds.has(request.senderId) && !removedUserIds.has(request.receiverId)
  );
  dbStore.state.blocks = dbStore.state.blocks.filter(
    (block) => !removedUserIds.has(block.blockerId) && !removedUserIds.has(block.blockedId)
  );
  dbStore.state.members = dbStore.state.members.filter((member) => !removedUserIds.has(member.userId));
  dbStore.state.notifications = dbStore.state.notifications.filter(
    (notification) => !removedUserIds.has(notification.userId)
  );
  dbStore.state.bookmarks = dbStore.state.bookmarks.filter(
    (bookmark) =>
      !removedUserIds.has(bookmark.userId) &&
      !(bookmark.serverId && ownedServerIds.has(bookmark.serverId)) &&
      !(bookmark.channelId && serverChannelIds.has(bookmark.channelId))
  );
  dbStore.state.subscriptions = dbStore.state.subscriptions.filter(
    (subscription) => !removedUserIds.has(subscription.userId)
  );
  dbStore.state.payments = dbStore.state.payments.filter((payment) => !removedUserIds.has(payment.userId));
  dbStore.state.supportTickets = dbStore.state.supportTickets
    .filter((ticket) => !removedUserIds.has(ticket.userId))
    .map((ticket) => ({
      ...ticket,
      messages: (ticket.messages || []).filter((message) => !removedUserIds.has(message.authorId)),
    }));

  for (const idea of dbStore.state.communityIdeas) {
    idea.upvoterIds = (idea.upvoterIds || []).filter((id) => !removedUserIds.has(id));
  }
  for (const event of dbStore.state.scheduledEvents) {
    event.interestedUserIds = (event.interestedUserIds || []).filter((id) => !removedUserIds.has(id));
  }

  dbStore.addAuditLog({
    serverId: null,
    actorId: userId,
    action: 'USER_ACCOUNT_DELETED',
    targetType: 'USER',
    targetId: userId,
    details: `Deleted account @${user.username} (${user.email}); removed ${ownedServerIds.size} owned server(s) and ${ownedBotIds.size} owned bot(s).`,
  });

  // Remove the user row last so audit attribution above still resolves.
  dbStore.state.users = dbStore.state.users.filter((candidate) => !removedUserIds.has(candidate.id));
  dbStore.save();
  res.json({ ok: true });
});
