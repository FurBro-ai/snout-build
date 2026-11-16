import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createChordApp } from '../backend/src/app.ts';
import { ENV } from '../backend/src/config/env.ts';
import { generateTotpCode } from '../backend/src/auth/totp.ts';
import { dbStore, type DatabaseState } from '../backend/src/store/dbStore.ts';
import { UPLOADS_DIR } from '../backend/src/config/uploads.ts';
import { initSocketGateway } from '../backend/src/websocket/socketGateway.ts';
import { NITRO_PLAN, PERMISSIONS } from '../shared/constants.ts';

let server: http.Server;
let baseUrl = '';
let snapshotState: DatabaseState;
const dbFilePath = path.resolve(process.cwd(), 'data', 'chord-db.json');
let dbExistedBefore = false;

async function api(
  pathname: string,
  options: RequestInit & { token?: string } = {}
): Promise<{ status: number; data: Record<string, any> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const resp = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, any>;
  return { status: resp.status, data };
}

beforeAll(async () => {
  dbExistedBefore = fs.existsSync(dbFilePath);
  snapshotState = JSON.parse(JSON.stringify(dbStore.state)) as DatabaseState;

  // Remove the seeded development handle so public registration behavior is
  // deterministic. The original state is restored (and persisted) in afterAll.
  dbStore.state.users = dbStore.state.users.filter((u) => u.username !== 'xyz');
  dbStore.state.sessions = dbStore.state.sessions.filter(
    (s) => !dbStore.state.users.some((u) => u.id === s.userId)
  );

  const app = createChordApp();
  server = http.createServer(app);
  initSocketGateway(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  dbStore.state = snapshotState;
  if (dbExistedBefore) {
    dbStore.saveImmediate();
  } else if (fs.existsSync(dbFilePath)) {
    fs.unlinkSync(dbFilePath);
  }
});

describe('Snout Full-Stack API Integration', () => {
  let aliceToken = '';
  let aliceId = '';
  let bobToken = '';
  let bobId = '';
  let xyzToken = '';
  let serverId = '';
  let channelId = '';

  it('registers two distinct users, verifies email, handles password reset & 2FA TOTP', async () => {
    const regA = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice_test',
        displayName: 'Alice',
        email: 'alice.test@example.com',
        password: 'StrongPassword123!',
      }),
    });
    expect(regA.status).toBe(201);
    expect(regA.data.token).toBeTruthy();
    expect(regA.data.user.isNitro).toBe(false);
    aliceToken = regA.data.token;
    aliceId = regA.data.user.id;

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const resetForExistingAccount = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice.test@example.com' }),
    });
    const resetForUnknownAccount = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(resetForExistingAccount.status).toBe(503);
    expect(resetForUnknownAccount.status).toBe(503);
    expect(resetForExistingAccount.data).not.toHaveProperty('resetToken');
    expect(dbStore.state.users.find((candidate) => candidate.id === aliceId)?.passwordResetToken).toBeNull();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    const publicIceConfig = await api('/api/voice/ice-config');
    expect(publicIceConfig.status).toBe(401);
    const previousTurnUrls = ENV.TURN_URLS;
    const previousTurnSecret = ENV.TURN_SECRET;
    ENV.TURN_URLS = 'turn:16.16.120.220:3478?transport=udp';
    ENV.TURN_SECRET = 'integration-test-shared-secret';
    const iceConfig = await api('/api/voice/ice-config', { token: aliceToken });
    expect(iceConfig.status).toBe(200);
    const turnServer = iceConfig.data.iceServers.find((server: { urls: string | string[] }) =>
      String(server.urls).startsWith('turn:')
    );
    expect(turnServer).toBeTruthy();
    expect(turnServer.credential).not.toBe(ENV.TURN_SECRET);
    expect(turnServer.credential).toBe(
      crypto.createHmac('sha1', ENV.TURN_SECRET).update(turnServer.username).digest('base64')
    );
    expect(Number(turnServer.username.split(':')[0])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    ENV.TURN_URLS = previousTurnUrls;
    ENV.TURN_SECRET = previousTurnSecret;

    const publicVoiceParticipants = await api('/api/voice/participants');
    expect(publicVoiceParticipants.status).toBe(401);
    const privateVoiceParticipants = await api('/api/voice/participants', { token: aliceToken });
    expect(privateVoiceParticipants.status).toBe(200);
    expect(Array.isArray(privateVoiceParticipants.data.participants)).toBe(true);

    // Verify email token
    const verifyRes = await api('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: regA.data.verificationToken }),
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.user.emailVerified).toBe(true);

    // Verify removed Google/Gmail OAuth sync endpoint returns 404
    const googleSyncRemoved = await api('/api/auth/firebase-sync', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'fake' }),
    });
    expect(googleSyncRemoved.status).toBe(404);

    // Setup and enable 2FA TOTP with scannable QR + 8 backup codes
    const totpSetup = await api('/api/auth/2fa/setup', { method: 'POST', token: aliceToken });
    expect(totpSetup.status).toBe(200);
    expect(totpSetup.data.secret).toBeTruthy();
    expect(totpSetup.data.otpauthUri).toContain('otpauth://totp/');
    expect(totpSetup.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const code = generateTotpCode(totpSetup.data.secret);

    const enable2fa = await api('/api/auth/2fa/enable', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ code }),
    });
    expect(enable2fa.status).toBe(200);
    expect(enable2fa.data.user.twoFactorEnabled).toBe(true);
    expect(Array.isArray(enable2fa.data.backupCodes)).toBe(true);
    expect(enable2fa.data.backupCodes).toHaveLength(8);
    expect(enable2fa.data.user.twoFactorBackupRemaining).toBe(8);

    // Login by USERNAME requires 2FA challengeToken first, then succeeds with TOTP code
    const loginStep1 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'alice_test', password: 'StrongPassword123!' }),
    });
    expect(loginStep1.status).toBe(200);
    expect(loginStep1.data.requiresTwoFactor).toBe(true);
    expect(loginStep1.data.challengeToken).toBeTruthy();

    const atUsernameLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '@alice_test', password: 'StrongPassword123!' }),
    });
    expect(atUsernameLogin.status).toBe(200);
    expect(atUsernameLogin.data.requiresTwoFactor).toBe(true);

    const trailingPeriodEmailLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'alice.test@example.com.', password: 'StrongPassword123!' }),
    });
    expect(trailingPeriodEmailLogin.status).toBe(200);
    expect(trailingPeriodEmailLogin.data.requiresTwoFactor).toBe(true);

    const loginStep2 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        challengeToken: loginStep1.data.challengeToken,
        totpCode: generateTotpCode(totpSetup.data.secret),
      }),
    });
    expect(loginStep2.status).toBe(200);
    expect(loginStep2.data.token).toBeTruthy();
    const loginAudit = dbStore.state.auditLogs.find(
      (entry) => entry.action === 'USER_LOGIN' && entry.targetId === aliceId
    );
    expect(loginAudit).toBeTruthy();
    expect(loginAudit?.details).toContain('127.0.0.1');
    aliceToken = loginStep2.data.token;

    // Login using a single-use recovery backup code succeeds once and consumes the code
    const backupLoginStep1 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice.test@example.com', password: 'StrongPassword123!' }),
    });
    expect(backupLoginStep1.status).toBe(200);
    expect(backupLoginStep1.data.challengeToken).toBeTruthy();

    const firstBackupCode = enable2fa.data.backupCodes[0];
    const backupLoginStep2 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        challengeToken: backupLoginStep1.data.challengeToken,
        backupCode: firstBackupCode,
      }),
    });
    expect(backupLoginStep2.status).toBe(200);
    expect(backupLoginStep2.data.user.twoFactorBackupRemaining).toBe(7);

    // Reusing the same consumed backup code fails with 401
    const reuseStep1 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'alice_test', password: 'StrongPassword123!' }),
    });
    const reuseStep2 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        challengeToken: reuseStep1.data.challengeToken,
        backupCode: firstBackupCode,
      }),
    });
    expect(reuseStep2.status).toBe(401);

    // Regenerate 8 fresh recovery backup codes using valid TOTP
    const regenRes = await api('/api/auth/2fa/backup-codes/regenerate', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ code: generateTotpCode(totpSetup.data.secret) }),
    });
    expect(regenRes.status).toBe(200);
    expect(regenRes.data.backupCodes).toHaveLength(8);
    expect(regenRes.data.user.twoFactorBackupRemaining).toBe(8);

    // Disable 2FA cleanly using one of the regenerated backup codes, then re-enable for clean state
    const disableRes = await api('/api/auth/2fa/disable', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ code: regenRes.data.backupCodes[0] }),
    });
    expect(disableRes.status).toBe(200);
    expect(disableRes.data.user.twoFactorEnabled).toBe(false);
    expect(disableRes.data.user.twoFactorBackupRemaining).toBe(0);

    // Verify Alice can now log in directly without 2FA
    const directLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'alice_test', password: 'StrongPassword123!' }),
    });
    expect(directLogin.status).toBe(200);
    expect(directLogin.data.token).toBeTruthy();
    expect(directLogin.data.requiresTwoFactor).toBeUndefined();
    aliceToken = directLogin.data.token;

    // Register second user Bob
    const regB = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'bob_test',
        displayName: 'Bob',
        email: 'bob.test@example.com',
        password: 'StrongPassword456!',
      }),
    });
    expect(regB.status).toBe(201);
    bobToken = regB.data.token;
    bobId = regB.data.user.id;
    expect(regB.data.user.platformRole).toBe('USER');

    // A public registration cannot gain administrator privileges by username.
    const regXyz = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'xyz',
        displayName: 'XYZ Admin',
        email: 'xyz.admin.test@example.com',
        password: 'XyzAdminPassword123!',
      }),
    });
    expect(regXyz.status).toBe(201);
    expect(regXyz.data.user.platformRole).toBe('USER');
    xyzToken = regXyz.data.token;

    const publicAdminOverview = await api('/api/admin/overview', { token: xyzToken });
    expect(publicAdminOverview.status).toBe(403);

    const testAdmin = dbStore.state.users.find((u) => u.id === regXyz.data.user.id);
    expect(testAdmin).toBeDefined();
    testAdmin!.platformRole = 'ADMIN';
    dbStore.save();

    const previousAdminAllowedIps = ENV.ADMIN_ALLOWED_IPS;
    ENV.ADMIN_ALLOWED_IPS = '192.0.2.10';
    const adminBlockedByIp = await api('/api/admin/overview', { token: regXyz.data.token });
    expect(adminBlockedByIp.status).toBe(403);
    ENV.ADMIN_ALLOWED_IPS = '127.0.0.1';

    const adminOverview = await api('/api/admin/overview', { token: regXyz.data.token });
    expect(adminOverview.status).toBe(200);
    expect(adminOverview.data.stats.totalUsers).toBeGreaterThanOrEqual(3);

    const userDetail = await api(`/api/admin/users/${aliceId}/detail`, { token: xyzToken });
    expect(userDetail.status).toBe(200);
    expect(userDetail.data.loginHistory.some((entry: { details: string }) => entry.details.includes('127.0.0.1'))).toBe(true);
    ENV.ADMIN_ALLOWED_IPS = previousAdminAllowedIps;

    // Non-admin user cannot rename username to reserved admin handle 'xyz'
    const hijackRes = await api('/api/users/me', {
      method: 'PATCH',
      token: bobToken,
      body: JSON.stringify({ username: 'xyz' }),
    });
    expect(hijackRes.status).toBe(403);

    // Public platform summary returns live counts without auth
    const summaryRes = await api('/api/platform/summary');
    expect(summaryRes.status).toBe(200);
    expect(typeof summaryRes.data.memberCount).toBe('number');
    expect(typeof summaryRes.data.serverCount).toBe('number');
  });

  it('supports friend requests, acceptance, DMs, and user blocking', async () => {
    const reqRes = await api('/api/friends/requests', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ target: 'bob_test' }),
    });
    expect(reqRes.status).toBe(201);
    const requestId = reqRes.data.request.id;

    const respondRes = await api(`/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({ action: 'ACCEPT' }),
    });
    expect(respondRes.status).toBe(200);

    // Create DM thread and exchange messages
    const dmRes = await api('/api/dms', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ participantIds: [bobId] }),
    });
    expect([200, 201]).toContain(dmRes.status);
    const threadId = dmRes.data.thread.id;

    const sendDm = await api(`/api/dms/${threadId}/messages`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ content: 'Hello @bob_test from Alice!' }),
    });
    expect(sendDm.status).toBe(201);
    expect(sendDm.data.message.mentions).toContain(bobId);

    const bobDms = await api(`/api/dms/${threadId}/messages`, { token: bobToken });
    expect(bobDms.status).toBe(200);
    expect(bobDms.data.messages.some((m: { content: string }) => m.content.includes('Hello @bob_test'))).toBe(true);
  });

  it('accepts authenticated multipart uploads and requires fresh auth for passwordless deletion', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['upload integration check'], { type: 'text/plain' }), 'upload-check.txt');
    const uploadResponse = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: formData,
    });
    const uploadData = (await uploadResponse.json()) as { attachment?: { url?: string } };
    expect(uploadResponse.status).toBe(201);
    expect(uploadData.attachment?.url).toMatch(/^\/uploads\//);
    const uploadedName = path.basename(uploadData.attachment!.url!);
    const uploadedResponse = await fetch(`${baseUrl}${uploadData.attachment!.url}`);
    expect(uploadedResponse.status).toBe(200);
    expect(uploadedResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(uploadedResponse.headers.get('content-security-policy')).toContain('sandbox');
    fs.unlinkSync(path.join(UPLOADS_DIR, uploadedName));

    const svgForm = new FormData();
    svgForm.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'profile.svg');
    const svgUpload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: svgForm,
    });
    const svgData = (await svgUpload.json()) as { attachment?: { url?: string } };
    expect(svgUpload.status).toBe(201);
    const svgResponse = await fetch(`${baseUrl}${svgData.attachment!.url}`);
    expect(svgResponse.headers.get('content-disposition')).toBe('attachment');
    expect(svgResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
    fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(svgData.attachment!.url!)));

    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'passwordless_test',
        email: 'passwordless.test@example.com',
        password: 'StrongPassword789!',
      }),
    });
    expect(registration.status).toBe(201);
    const passwordlessUser = dbStore.state.users.find((user) => user.id === registration.data.user.id)!;
    passwordlessUser.passwordHash = null;
    const passwordlessSession = dbStore.state.sessions.find((session) => session.userId === passwordlessUser.id)!;
    passwordlessSession.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();

    const staleDelete = await api('/api/auth/account', {
      method: 'DELETE',
      token: registration.data.token,
      body: JSON.stringify({ confirmUsername: passwordlessUser.username, confirmation: 'DELETE MY ACCOUNT' }),
    });
    expect(staleDelete.status).toBe(401);
    expect(staleDelete.data.error).toContain('sign in again');

    passwordlessSession.createdAt = new Date().toISOString();
    const freshDelete = await api('/api/auth/account', {
      method: 'DELETE',
      token: registration.data.token,
      body: JSON.stringify({ confirmUsername: passwordlessUser.username, confirmation: 'DELETE MY ACCOUNT' }),
    });
    expect(freshDelete.status).toBe(200);
    expect(freshDelete.data.ok).toBe(true);
  });

  it('enforces server RBAC permissions, invites, messaging, reactions, pins, and bots', async () => {
    const createSrv = await api('/api/servers', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ name: 'Synth Lab', description: 'Private test server', isPublic: false }),
    });
    expect(createSrv.status).toBe(201);
    serverId = createSrv.data.server.id;

    const srvBundle = await api(`/api/servers/${serverId}`, { token: aliceToken });
    expect(srvBundle.status).toBe(200);
    channelId = srvBundle.data.channels.find((c: { type: string }) => c.type === 'TEXT').id;

    // Create invite link and join as Bob
    const invRes = await api(`/api/servers/${serverId}/invites`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ maxUses: 5 }),
    });
    expect(invRes.status).toBe(201);

    const joinRes = await api(`/api/servers/invites/${invRes.data.invite.code}/join`, {
      method: 'POST',
      token: bobToken,
    });
    expect(joinRes.status).toBe(200);

    // Bob (plain member) is forbidden from creating channels or kicking owner
    const bobCreateChan = await api(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({ name: 'unauthorized', type: 'TEXT' }),
    });
    expect(bobCreateChan.status).toBe(403);

    // Alice (owner) can create a channel
    const aliceCreateChan = await api(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ name: 'releases', type: 'TEXT' }),
    });
    expect(aliceCreateChan.status).toBe(201);

    // Send message, react, edit, pin
    const msgRes = await api(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ content: 'Deploy **v1.0** cleanly' }),
    });
    expect(msgRes.status).toBe(201);
    const msgId = msgRes.data.message.id;

    const reactRes = await api(`/api/messages/${msgId}/reactions`, {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({ emoji: '🔥' }),
    });
    expect(reactRes.status).toBe(200);
    expect(reactRes.data.message.reactions[0].userIds).toContain(bobId);

    const pinRes = await api(`/api/messages/${msgId}/pin`, {
      method: 'POST',
      token: aliceToken,
    });
    expect(pinRes.status).toBe(200);
    expect(pinRes.data.message.isPinned).toBe(true);

    // Create custom bot, authorize on server, send message via Bot Gateway API
    const botRes = await api('/api/bots', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ name: 'BuildBot', description: 'CI announcer' }),
    });
    expect(botRes.status).toBe(201);
    const botId = botRes.data.bot.id;
    const botToken = botRes.data.botToken;

    const authBot = await api(`/api/bots/${botId}/authorize`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ serverId }),
    });
    expect(authBot.status).toBe(200);

    const storedBot = dbStore.state.bots.find((bot) => bot.id === botId)!;
    const originalBotPermissions = storedBot.permissions;
    storedBot.permissions &= ~PERMISSIONS.SEND_MESSAGES;
    const deniedByScope = await api(`/api/bots/gateway/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: JSON.stringify({ content: 'This should be denied by the bot scope.' }),
    });
    expect(deniedByScope.status).toBe(403);
    storedBot.permissions = originalBotPermissions;

    const botChannel = dbStore.state.channels.find((channel) => channel.id === channelId)!;
    botChannel.overrides.push({
      id: 'test-bot-send-deny',
      channelId,
      targetType: 'USER',
      targetId: storedBot.botUserId,
      allow: 0,
      deny: PERMISSIONS.SEND_MESSAGES,
    });
    const deniedBotMsg = await api(`/api/bots/gateway/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: JSON.stringify({ content: 'This should be denied by channel permissions.' }),
    });
    expect(deniedBotMsg.status).toBe(403);
    botChannel.overrides = botChannel.overrides.filter((override) => override.id !== 'test-bot-send-deny');

    const botMsgRes = await api(`/api/bots/gateway/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      body: JSON.stringify({ content: 'Build passed via Bot API!' }),
    });
    expect(botMsgRes.status).toBe(201);
    expect(botMsgRes.data.message.author.isBot).toBe(true);
  });

  it('enforces strict $2.00/month Platega verification and never fabricates Nitro activations', async () => {
    // 1. Check plan pricing strictly equals $2.00 USD / month
    const cfg = await api('/api/payments/config', { token: aliceToken });
    expect(cfg.status).toBe(200);
    expect(cfg.data.plan.priceUsd).toBe(2);
    expect(cfg.data.plan.currency).toBe('USD');
    expect(cfg.data.plan.interval).toBe('month');
    expect(NITRO_PLAN.priceUsd).toBe(2);

    // 2. When Platega merchant env vars are absent, /api/payments/create returns 503 instead of faking checkout
    const prevMerchant = ENV.PLATEGA_MERCHANT_ID;
    const prevSecret = ENV.PLATEGA_SECRET;
    const prevWebhookSecret = ENV.PLATEGA_WEBHOOK_SECRET;
    ENV.PLATEGA_MERCHANT_ID = '';
    ENV.PLATEGA_SECRET = '';
    ENV.PLATEGA_WEBHOOK_SECRET = '';

    const unconfiguredRes = await api('/api/payments/create', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ paymentMethod: 2 }),
    });
    expect(unconfiguredRes.status).toBe(503);
    expect(unconfiguredRes.data.missingVars).toContain('PLATEGA_MERCHANT_ID');

    // 3. Configure Platega test credentials & mock Platega upstream /transaction/process endpoint
    ENV.PLATEGA_MERCHANT_ID = 'test-merchant-id';
    ENV.PLATEGA_SECRET = 'test-merchant-secret';
    ENV.PLATEGA_WEBHOOK_SECRET = 'test-merchant-secret';

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith(ENV.PLATEGA_API_URL)) {
        const reqBody = JSON.parse(String(init?.body || '{}'));
        expect(reqBody.paymentDetails.amount).toBe(2);
        expect(reqBody.paymentDetails.currency).toBe('USD');
        return new Response(
          JSON.stringify({
            transactionId: 'platega-tx-real-001',
            status: 'PENDING',
            redirect: 'https://pay.platega.io/checkout/platega-tx-real-001',
            merchantId: ENV.PLATEGA_MERCHANT_ID,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    });

    const createPay = await api('/api/payments/create', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ paymentMethod: 2 }),
    });
    fetchSpy.mockRestore();

    expect(createPay.status).toBe(201);
    expect(createPay.data.redirectUrl).toBe('https://pay.platega.io/checkout/platega-tx-real-001');
    expect(createPay.data.payment.status).toBe('PENDING');

    // User MUST NOT have Nitro yet before verified webhook
    const meBefore = await api('/api/auth/me', { token: aliceToken });
    expect(meBefore.data.user.isNitro).toBe(false);

    // 4. Unauthenticated webhook is rejected with 401
    const badWebhook = await api('/api/payments/platega/webhook', {
      method: 'POST',
      headers: { 'X-MerchantId': 'wrong', 'X-Secret': 'wrong' },
      body: JSON.stringify({
        id: 'platega-tx-real-001',
        amount: 2.0,
        currency: 'USD',
        status: 'CONFIRMED',
      }),
    });
    expect(badWebhook.status).toBe(401);

    // 5. Tampered amount/currency webhook is rejected with 400 and does NOT activate Nitro
    const tamperedWebhook = await api('/api/payments/platega/webhook', {
      method: 'POST',
      headers: {
        'X-MerchantId': ENV.PLATEGA_MERCHANT_ID,
        'X-Secret': ENV.PLATEGA_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        id: 'platega-tx-real-001',
        amount: 0.5,
        currency: 'USD',
        status: 'CONFIRMED',
      }),
    });
    expect(tamperedWebhook.status).toBe(400);
    const meAfterTamper = await api('/api/auth/me', { token: aliceToken });
    expect(meAfterTamper.data.user.isNitro).toBe(false);

    // 6. Verified $2.00 USD CONFIRMED webhook activates SNOUT NITRO
    // Also verify sandbox simulation endpoint has been removed
    const sandboxRemoved = await api('/api/payments/sandbox/simulate', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ status: 'CONFIRMED' }),
    });
    expect(sandboxRemoved.status).toBe(404);
    const validWebhook = await api('/api/payments/platega/webhook', {
      method: 'POST',
      headers: {
        'X-MerchantId': ENV.PLATEGA_MERCHANT_ID,
        'X-Secret': ENV.PLATEGA_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        id: 'platega-tx-real-001',
        amount: 2.0,
        currency: 'USD',
        status: 'CONFIRMED',
        payload: createPay.data.payment.orderId,
      }),
    });
    expect(validWebhook.status).toBe(200);
    expect(validWebhook.data.nitroActivated).toBe(true);

    const meAfterConfirm = await api('/api/auth/me', { token: aliceToken });
    expect(meAfterConfirm.data.user.isNitro).toBe(true);
    expect(meAfterConfirm.data.subscription.status).toBe('ACTIVE');
    expect(meAfterConfirm.data.subscription.priceUsd).toBe(2);

    // 7. Duplicate CONFIRMED webhook is idempotent (does not double-extend)
    const periodEndBeforeDup = meAfterConfirm.data.subscription.currentPeriodEnd;
    const dupWebhook = await api('/api/payments/platega/webhook', {
      method: 'POST',
      headers: {
        'X-MerchantId': ENV.PLATEGA_MERCHANT_ID,
        'X-Secret': ENV.PLATEGA_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        id: 'platega-tx-real-001',
        amount: 2.0,
        currency: 'USD',
        status: 'CONFIRMED',
      }),
    });
    expect(dupWebhook.status).toBe(200);
    expect(dupWebhook.data.idempotent).toBe(true);
    const meAfterDup = await api('/api/auth/me', { token: aliceToken });
    expect(meAfterDup.data.subscription.currentPeriodEnd).toBe(periodEndBeforeDup);

    // 7b. Animated banners & Nitro decorations require active Nitro, then succeed for Alice
    const freeBannerBlock = await api('/api/users/me', {
      method: 'PATCH',
      token: bobToken,
      body: JSON.stringify({ bannerUrl: 'preset:aurora_drift' }),
    });
    expect(freeBannerBlock.status).toBe(403);

    const nitroBannerUpdate = await api('/api/users/me', {
      method: 'PATCH',
      token: aliceToken,
      body: JSON.stringify({
        bannerUrl: 'preset:aurora_drift',
        profileDecoration: 'chromatic_spin',
      }),
    });
    expect(nitroBannerUpdate.status).toBe(200);
    expect(nitroBannerUpdate.data.user.bannerUrl).toBe('preset:aurora_drift');
    expect(nitroBannerUpdate.data.user.profileDecoration).toBe('chromatic_spin');

    // Server animated banner update succeeds for server owner
    const srvBannerRes = await api(`/api/servers/${serverId}`, {
      method: 'PATCH',
      token: aliceToken,
      body: JSON.stringify({ bannerUrl: 'preset:soundwave_horizon' }),
    });
    expect(srvBannerRes.status).toBe(200);
    expect(srvBannerRes.data.server.bannerUrl).toBe('preset:soundwave_horizon');

    // 8. Cancel subscription cleanly
    const cancelRes = await api('/api/subscriptions/cancel', { method: 'POST', token: aliceToken });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.data.subscription.status).toBe('CANCELLED');

    ENV.PLATEGA_MERCHANT_ID = prevMerchant;
    ENV.PLATEGA_SECRET = prevSecret;
    ENV.PLATEGA_WEBHOOK_SECRET = prevWebhookSecret;
  });

  it('powers built-in SQLite database engine, SQL console, collaborative server tables, events, bookmarks & search', async () => {
    // 1. Server Built-in Collaborative Databases (Bob cannot create table; Alice owner can)
    const bobCreateTbl = await api(`/api/servers/${serverId}/databases`, {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({
        name: 'Unauthorized',
        columns: [{ name: 'Item', type: 'text' }],
      }),
    });
    expect(bobCreateTbl.status).toBe(403);

    const createTbl = await api(`/api/servers/${serverId}/databases`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({
        name: 'Sprint Tasks',
        description: 'Release tracking table',
        columns: [
          { id: 'title', name: 'Task', type: 'text' },
          { id: 'status', name: 'Status', type: 'status', options: ['Todo', 'Done'] },
          { id: 'done', name: 'Complete', type: 'checkbox' },
        ],
      }),
    });
    expect(createTbl.status).toBe(201);
    const tableId = createTbl.data.table.id;

    // Member Bob can add & update rows cleanly
    const addRow = await api(`/api/servers/${serverId}/databases/${tableId}/rows`, {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({
        cells: { title: 'Verify built-in SQLite WAL sync', status: 'Todo', done: false },
      }),
    });
    expect(addRow.status).toBe(201);
    const rowId = addRow.data.row.id;

    const patchRow = await api(`/api/servers/${serverId}/databases/${tableId}/rows/${rowId}`, {
      method: 'PATCH',
      token: bobToken,
      body: JSON.stringify({ cells: { status: 'Done', done: true } }),
    });
    expect(patchRow.status).toBe(200);
    expect(patchRow.data.row.cells.done).toBe(true);

    // 2. Scheduled Server Events & RSVP
    const createEvt = await api(`/api/servers/${serverId}/events`, {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({
        title: 'Snout Release Showcase',
        description: 'Live voice walkthrough',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        locationLabel: 'Voice Lounge',
      }),
    });
    expect(createEvt.status).toBe(201);
    const evtId = createEvt.data.event.id;

    const rsvpRes = await api(`/api/servers/${serverId}/events/${evtId}/rsvp`, {
      method: 'POST',
      token: bobToken,
    });
    expect(rsvpRes.status).toBe(200);
    expect(rsvpRes.data.event.interestedUserIds).toContain(bobId);

    // 3. Personal Saved Bookmarks
    const chanMsgs = await api(`/api/channels/${channelId}/messages`, { token: aliceToken });
    const firstMsgId = chanMsgs.data.messages[0].id;
    const bmRes = await api('/api/bookmarks', {
      method: 'POST',
      token: aliceToken,
      body: JSON.stringify({ messageId: firstMsgId, note: 'Important deploy note' }),
    });
    expect(bmRes.status).toBe(201);

    const listBm = await api('/api/bookmarks', { token: aliceToken });
    expect(listBm.status).toBe(200);
    expect(listBm.data.bookmarks.some((b: { id: string }) => b.id === bmRes.data.bookmark.id)).toBe(true);

    // 4. Global Search matches both messages and built-in database rows
    const searchRes = await api('/api/search?q=SQLite', { token: bobToken });
    expect(searchRes.status).toBe(200);
    expect(searchRes.data.databaseRows.length).toBeGreaterThanOrEqual(1);

    // 5. Built-in SQLite Engine Admin Console Endpoints (non-admin blocked, admin xyz permitted)
    const bobDbBlock = await api('/api/admin/database/summary', { token: bobToken });
    expect(bobDbBlock.status).toBe(403);

    const summaryRes = await api('/api/admin/database/summary', { token: xyzToken });
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.data.summary.journalMode).toBe('WAL');
    expect(summaryRes.data.summary.tables.length).toBeGreaterThanOrEqual(13);

    const sqlRead = await api('/api/admin/database/query', {
      method: 'POST',
      token: xyzToken,
      body: JSON.stringify({ sql: "SELECT username, platform_role FROM users WHERE username = 'xyz'" }),
    });
    expect(sqlRead.status).toBe(200);
    expect(sqlRead.data.result.rows[0].platform_role).toBe('ADMIN');

    const sqlWriteBlock = await api('/api/admin/database/query', {
      method: 'POST',
      token: xyzToken,
      body: JSON.stringify({ sql: 'DROP TABLE users' }),
    });
    expect(sqlWriteBlock.status).toBe(400);

    const maintRes = await api('/api/admin/database/maintenance', {
      method: 'POST',
      token: xyzToken,
    });
    expect(maintRes.status).toBe(200);
    expect(maintRes.data.report.integrity).toBe('ok');

    // 6. Enhanced Admin Console: 7-day analytics, user/server deep inspection, sessions, workspace assets, and broadcast
    const ovEnhanced = await api('/api/admin/overview', { token: xyzToken });
    expect(ovEnhanced.status).toBe(200);
    expect(Array.isArray(ovEnhanced.data.activitySeries)).toBe(true);
    expect(ovEnhanced.data.activitySeries.length).toBe(7);
    expect(typeof ovEnhanced.data.stats.totalDatabaseRows).toBe('number');

    const userDetail = await api(`/api/admin/users/${bobId}/detail`, { token: xyzToken });
    expect(userDetail.status).toBe(200);
    expect(userDetail.data.user.username).toBe('bob_test');

    const srvPatch = await api(`/api/admin/servers/${serverId}`, {
      method: 'PATCH',
      token: xyzToken,
      body: JSON.stringify({ boostTier: 3, isPublic: true }),
    });
    expect(srvPatch.status).toBe(200);
    expect(srvPatch.data.server.boostTier).toBe(3);

    const srvDetail = await api(`/api/admin/servers/${serverId}/detail`, { token: xyzToken });
    expect(srvDetail.status).toBe(200);
    expect(srvDetail.data.channels.length).toBeGreaterThanOrEqual(1);

    const assetsRes = await api('/api/admin/workspace-assets', { token: xyzToken });
    expect(assetsRes.status).toBe(200);
    expect(assetsRes.data.databases.length).toBeGreaterThanOrEqual(1);
    expect(assetsRes.data.events.length).toBeGreaterThanOrEqual(1);

    const bobBroadcastForbidden = await api('/api/admin/broadcast', {
      method: 'POST',
      token: bobToken,
      body: JSON.stringify({ title: 'Hack', body: 'Should fail' }),
    });
    expect(bobBroadcastForbidden.status).toBe(403);

    const broadcastRes = await api('/api/admin/broadcast', {
      method: 'POST',
      token: xyzToken,
      body: JSON.stringify({ title: 'System Maintenance Notice', body: 'SQLite WAL checkpoint complete.' }),
    });
    expect(broadcastRes.status).toBe(201);
    expect(broadcastRes.data.recipientCount).toBeGreaterThanOrEqual(3);

    const bobNotifs = await api('/api/notifications', { token: bobToken });
    expect(bobNotifs.status).toBe(200);
    expect(
      bobNotifs.data.notifications.some((n: { title: string }) => n.title === 'System Maintenance Notice')
    ).toBe(true);

    const sessionsRes = await api('/api/admin/sessions', { token: xyzToken });
    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.data.sessions.length).toBeGreaterThanOrEqual(2);
  });
});
