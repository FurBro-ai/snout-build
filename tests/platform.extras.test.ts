import fs from 'fs';
import http from 'http';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChordApp } from '../backend/src/app.ts';
import { dbStore, type DatabaseState } from '../backend/src/store/dbStore.ts';
import { initSocketGateway } from '../backend/src/websocket/socketGateway.ts';

let server: http.Server;
let baseUrl = '';
let snapshotState: DatabaseState;
const dbFilePath = path.resolve(process.cwd(), 'data', 'chord-db.json');
let dbExistedBefore = false;

async function api(pathname: string, options: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.headers) Object.assign(headers, options.headers as Record<string, string>);
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const resp = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const data = (await resp.json().catch(() => ({}))) as Record<string, any>;
  return { status: resp.status, data };
}

beforeAll(async () => {
  dbExistedBefore = fs.existsSync(dbFilePath);
  snapshotState = JSON.parse(JSON.stringify(dbStore.state)) as DatabaseState;
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
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
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

describe('Community, support, badges, integrations & admin databases', () => {
  let adminToken = '';
  let memberToken = '';
  let memberId = '';
  let serverId = '';
  let tableId = '';

  it('exposes the new member surfaces and admin console', async () => {
    const regAdmin = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'xyz',
        displayName: 'XYZ Admin',
        email: 'xyz.extras@example.com',
        password: 'XyzAdminPassword123!',
      }),
    });
    expect(regAdmin.status).toBe(201);
    expect(regAdmin.data.user.platformRole).toBe('USER');
    await api('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: regAdmin.data.verificationToken }),
    });
    const adminUser = dbStore.state.users.find((user) => user.id === regAdmin.data.user.id)!;
    adminUser.platformRole = 'ADMIN';
    dbStore.save();
    adminToken = regAdmin.data.token;

    const regMember = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'member_extras',
        displayName: 'Member',
        email: 'member.extras@example.com',
        password: 'MemberPassword123!',
      }),
    });
    expect(regMember.status).toBe(201);
    memberToken = regMember.data.token;
    memberId = regMember.data.user.id;

    const servers = await api('/api/servers', { token: memberToken });
    expect(servers.status).toBe(200);
    serverId = servers.data.servers[0].id;

    // --- Community roadmap votes ---
    const ideas = await api('/api/community/ideas', { token: memberToken });
    expect(ideas.status).toBe(200);
    expect(Array.isArray(ideas.data.ideas)).toBe(true);

    const created = await api('/api/community/ideas', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({
        title: 'Add per-server emoji packs',
        description: 'Let server owners upload custom emoji packs that members can use everywhere.',
        category: 'Feature',
      }),
    });
    expect(created.status).toBe(201);
    expect(created.data.idea.status).toBe('UNDER_REVIEW');
    expect(created.data.idea.upvoterIds).toContain(memberId);

    const vote = await api(`/api/community/ideas/${created.data.idea.id}/vote`, { method: 'POST', token: adminToken });
    expect(vote.status).toBe(200);
    expect(vote.data.idea.hasUpvoted).toBe(true);
    expect(vote.data.idea.voteCount).toBe(2);

    const adminIdeas = await api('/api/admin/community/ideas', { token: adminToken });
    expect(adminIdeas.status).toBe(200);
    const adminBlock = await api('/api/admin/community/ideas', { token: memberToken });
    expect(adminBlock.status).toBe(403);

    const ideaPatch = await api(`/api/admin/community/ideas/${created.data.idea.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ status: 'PLANNED', adminResponse: 'On the roadmap for next sprint.' }),
    });
    expect(ideaPatch.status).toBe(200);
    expect(ideaPatch.data.idea.status).toBe('PLANNED');

    // --- Support centre ---
    const ticket = await api('/api/support/tickets', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({
        subject: 'Nitro not activated after payment',
        message: 'I completed checkout but my Nitro badge is still missing. Order snout-nitro-demo.',
        category: 'Billing',
        priority: 'HIGH',
      }),
    });
    expect(ticket.status).toBe(201);
    expect(ticket.data.ticket.status).toBe('OPEN');
    const ticketId = ticket.data.ticket.id;

    const otherMemberBlock = await api(`/api/support/tickets/${ticketId}`, { token: adminToken });
    expect(otherMemberBlock.status).toBe(404);

    const inbox = await api('/api/admin/support', { token: adminToken });
    expect(inbox.status).toBe(200);
    expect(inbox.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    const staffReply = await api(`/api/admin/support/${ticketId}/messages`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ body: 'We are reconciling this with Platega now.' }),
    });
    expect(staffReply.status).toBe(201);
    expect(staffReply.data.ticket.status).toBe('WAITING_ON_USER');

    const ticketPatch = await api(`/api/admin/support/${ticketId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ status: 'RESOLVED', priority: 'URGENT' }),
    });
    expect(ticketPatch.status).toBe(200);
    expect(ticketPatch.data.ticket.status).toBe('RESOLVED');
    expect(ticketPatch.data.ticket.priority).toBe('URGENT');

    // --- Platform badges ---
    const badgeList = await api('/api/admin/badges', { token: adminToken });
    expect(badgeList.status).toBe(200);
    expect(badgeList.data.badges.length).toBeGreaterThanOrEqual(8);
    expect(badgeList.data.badges.some((b: { id: string }) => b.id === 'badge-staff')).toBe(true);

    const newBadge = await api('/api/admin/badges', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ label: 'Launch Champion', description: 'Shipped a major platform launch.', icon: '🚀', color: '#10B981', priority: 75 }),
    });
    expect(newBadge.status).toBe(201);
    expect(newBadge.data.badge.label).toBe('Launch Champion');

    const award = await api(`/api/admin/users/${memberId}/badges`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ badgeIds: [newBadge.data.badge.id, 'badge-early-adopter'] }),
    });
    expect(award.status).toBe(200);
    expect(award.data.user.badgeIds).toHaveLength(2);
    expect(award.data.user.badges?.map((b: { id: string }) => b.id)).toContain('badge-early-adopter');

    const memberMe = await api('/api/auth/me', { token: memberToken });
    expect(memberMe.status).toBe(200);
    expect(memberMe.data.user.badges?.length).toBe(2);

    const deleteBadge = await api(`/api/admin/badges/${newBadge.data.badge.id}`, { method: 'DELETE', token: adminToken });
    expect(deleteBadge.status).toBe(200);

    const systemBadgeDelete = await api('/api/admin/badges/badge-staff', { method: 'DELETE', token: adminToken });
    expect(systemBadgeDelete.status).toBe(400);

    // --- Platega integration from the admin console ---
    const integration = await api('/api/admin/integrations', { token: adminToken });
    expect(integration.status).toBe(200);
    expect(integration.data.platega.provider).toBe('Platega');
    expect(integration.data.platega.webhookUrl).toContain('/api/payments/platega/webhook');

    const saveIntegration = await api('/api/admin/integrations/platega', {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ merchantId: 'test-merchant-123', secret: 'test-secret-456', apiUrl: 'https://app.platega.io', sandboxMode: true }),
    });
    expect(saveIntegration.status).toBe(200);
    expect(saveIntegration.data.platega.merchantIdSet).toBe(true);
    expect(saveIntegration.data.platega.secretSet).toBe(true);
    expect(saveIntegration.data.platega.merchantId).toContain('••');

    const paymentConfig = await api('/api/payments/config', { token: memberToken });
    expect(paymentConfig.status).toBe(200);
    expect(paymentConfig.data.configured).toBe(true);

    const priceUpdate = await api('/api/admin/config', {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ nitroPriceUsd: 3.5 }),
    });
    expect(priceUpdate.status).toBe(200);
    expect(priceUpdate.data.platformConfig.nitroPriceUsd).toBe(3.5);
    expect(priceUpdate.data.platformConfig.platega.secret).toBeUndefined();

    const clearIntegration = await api('/api/admin/integrations/platega', {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ clearCredentials: true }),
    });
    expect(clearIntegration.status).toBe(200);
    expect(clearIntegration.data.platega.secretSet).toBe(false);

    // --- Admin-managed community databases ---
    const createdTable = await api('/api/admin/workspace-assets/databases', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        serverId,
        name: 'Admin Ops Board',
        description: 'Managed centrally from the admin console.',
        columns: [
          { name: 'Task', type: 'text' },
          { name: 'Status', type: 'status' },
          { name: 'Points', type: 'number' },
          { name: 'Done', type: 'checkbox' },
        ],
      }),
    });
    expect(createdTable.status).toBe(201);
    tableId = createdTable.data.table.id;
    expect(createdTable.data.table.columns).toHaveLength(4);

    const tableDetail = await api(`/api/admin/workspace-assets/databases/${tableId}`, { token: adminToken });
    expect(tableDetail.status).toBe(200);
    expect(tableDetail.data.rows).toHaveLength(0);
    const columnIds: Record<string, string> = {};
    for (const col of tableDetail.data.table.columns) columnIds[col.name] = col.id;

    const addedRow = await api(`/api/admin/workspace-assets/databases/${tableId}/rows`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        cells: { [columnIds.Task]: 'Reconcile Platega ledger', [columnIds.Status]: 'In Progress', [columnIds.Points]: 8, [columnIds.Done]: false },
      }),
    });
    expect(addedRow.status).toBe(201);

    const rowPatch = await api(`/api/admin/workspace-assets/databases/${tableId}/rows/${addedRow.data.row.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ cells: { [columnIds.Done]: true, [columnIds.Points]: 13 } }),
    });
    expect(rowPatch.status).toBe(200);
    expect(rowPatch.data.row.cells[columnIds.Done]).toBe(true);
    expect(rowPatch.data.row.cells[columnIds.Points]).toBe(13);

    const rowsAfter = await api(`/api/admin/workspace-assets/databases/${tableId}/rows`, { token: adminToken });
    expect(rowsAfter.data.rows).toHaveLength(1);

    const delRow = await api(`/api/admin/workspace-assets/databases/${tableId}/rows/${addedRow.data.row.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(delRow.status).toBe(200);

    const delTable = await api(`/api/admin/workspace-assets/databases/${tableId}`, { method: 'DELETE', token: adminToken });
    expect(delTable.status).toBe(200);

    // Members cannot reach any admin console route
    const memberAdminBlock = await api('/api/admin/badges', { token: memberToken });
    expect(memberAdminBlock.status).toBe(403);
  });
});
