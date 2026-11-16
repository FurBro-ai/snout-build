import 'dotenv/config';
import { randomUUID } from 'crypto';
import { stdin, stdout } from 'process';
import { hashPassword } from '../backend/src/auth/authMiddleware.ts';
import { dbStore, type StoredUser } from '../backend/src/store/dbStore.ts';
import { disconnectSessionSockets } from '../backend/src/websocket/socketGateway.ts';

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command directly in an interactive terminal.');

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';

    const restore = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };

    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          restore();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restore();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const username = process.argv[3]?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !username || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username) || process.argv.length !== 4) {
    throw new Error('Usage: npm run admin:provision -- <email> <username>');
  }

  const existing = dbStore.state.users.find((candidate) => candidate.email.toLowerCase() === email);
  if (existing && !existing.emailVerified) {
    throw new Error('The existing account is unverified. Verify ownership before provisioning it.');
  }
  if (existing?.isBot || existing?.isSuspended) {
    throw new Error('The target account cannot be provisioned while it is a bot or suspended.');
  }
  const usernameOwner = dbStore.state.users.find(
    (candidate) => candidate.username.toLowerCase() === username.toLowerCase() && candidate.id !== existing?.id
  );
  if (usernameOwner) throw new Error('That username is already in use by another account.');

  const password = await readHidden('New password (minimum 16 characters, input hidden): ');
  const confirmation = await readHidden('Repeat new password: ');
  if (password.length < 16 || password.length > 128) {
    throw new Error('Password must be between 16 and 128 characters.');
  }
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const now = new Date().toISOString();
  const revokedSessionIds: string[] = [];
  if (existing) {
    existing.username = username;
    existing.displayName = username;
    existing.passwordHash = hashPassword(password);
    existing.platformRole = 'ADMIN';
    existing.updatedAt = now;
    revokedSessionIds.push(...dbStore.state.sessions.filter((session) => session.userId === existing.id).map((session) => session.id));
    dbStore.state.sessions = dbStore.state.sessions.filter((session) => session.userId !== existing.id);
  } else {
    const admin: StoredUser = {
      id: randomUUID(),
      firebaseUid: null,
      username,
      discriminator: String(Math.floor(1000 + Math.random() * 9000)),
      displayName: username,
      email,
      passwordHash: hashPassword(password),
      emailVerified: true,
      emailVerificationToken: null,
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
      platformRole: 'ADMIN',
      badgeIds: [],
      createdAt: now,
      updatedAt: now,
    };
    dbStore.state.users.push(admin);
  }

  dbStore.save();
  for (const sessionId of revokedSessionIds) disconnectSessionSockets(sessionId, { reason: 'Administrator account re-provisioned' });
  console.log(`Administrator account provisioned for ${email}. Sign in and enable two-factor authentication.`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});