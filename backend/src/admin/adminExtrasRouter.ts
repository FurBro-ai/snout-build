import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  AdminBadge,
  IdeaStatus,
  ServerDatabaseColumn,
  ServerDatabaseRow,
  TicketPriority,
  TicketStatus,
} from '../../../shared/types.ts';
import type { AuthenticatedRequest } from '../auth/authMiddleware.ts';
import {
  getNitroPriceUsd,
  getPlategaRuntimeConfig,
  getPlategaWebhookUrl,
  isPlategaConfiguredNow,
} from '../payments/plategaService.ts';
import { dbStore, EMPTY_PLATEGA_CONFIG } from '../store/dbStore.ts';
import { emitGlobal, emitToServer, emitToUser } from '../websocket/socketGateway.ts';

export const adminExtrasRouter = Router();

/* ------------------------------------------------------------------ */
/* Platform badges                                                     */
/* ------------------------------------------------------------------ */

adminExtrasRouter.get('/badges', (_req, res) => {
  const badges = [...dbStore.state.badges].sort((a, b) => b.priority - a.priority);
  const usage: Record<string, number> = {};
  for (const badge of badges) usage[badge.id] = 0;
  for (const user of dbStore.state.users) {
    for (const id of user.badgeIds || []) {
      if (usage[id] !== undefined) usage[id] += 1;
    }
  }
  res.json({ badges, usage });
});

adminExtrasRouter.post('/badges', (req: AuthenticatedRequest, res) => {
  const label = String(req.body?.label || '').trim();
  const description = String(req.body?.description || '').trim();
  const color = String(req.body?.color || '#5865F2').trim();
  const icon = String(req.body?.icon || '🏅').trim().slice(0, 8) || '🏅';
  const priority = Math.max(0, Math.min(999, Number(req.body?.priority ?? 50)));
  if (label.length < 2 || label.length > 32) {
    return res.status(400).json({ error: 'Badge label must be 2-32 characters' });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'Badge color must be a 6-digit hex value' });
  }
  const badge: AdminBadge = {
    id: `badge-${uuidv4().slice(0, 8)}`,
    label,
    description: description.slice(0, 160),
    color,
    icon,
    priority: Number.isFinite(priority) ? priority : 50,
    isSystem: false,
    createdAt: new Date().toISOString(),
  };
  dbStore.state.badges.push(badge);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_BADGE_CREATED',
    targetType: 'BADGE',
    targetId: badge.id,
    details: `Created platform badge "${badge.label}"`,
  });
  dbStore.save();
  res.status(201).json({ badge });
});

adminExtrasRouter.patch('/badges/:badgeId', (req: AuthenticatedRequest, res) => {
  const badge = dbStore.state.badges.find((b) => b.id === req.params.badgeId);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  const { label, description, color, icon, priority } = req.body as Partial<AdminBadge>;
  if (label !== undefined) {
    const next = String(label).trim();
    if (next.length < 2 || next.length > 32) return res.status(400).json({ error: 'Badge label must be 2-32 characters' });
    badge.label = next;
  }
  if (description !== undefined) badge.description = String(description).trim().slice(0, 160);
  if (color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(color))) return res.status(400).json({ error: 'Badge color must be a 6-digit hex value' });
    badge.color = String(color);
  }
  if (icon !== undefined) badge.icon = String(icon).trim().slice(0, 8) || badge.icon;
  if (priority !== undefined && Number.isFinite(Number(priority))) {
    badge.priority = Math.max(0, Math.min(999, Number(priority)));
  }
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_BADGE_UPDATED',
    targetType: 'BADGE',
    targetId: badge.id,
    details: `Updated platform badge "${badge.label}"`,
  });
  dbStore.save();
  res.json({ badge });
});

adminExtrasRouter.delete('/badges/:badgeId', (req: AuthenticatedRequest, res) => {
  const badge = dbStore.state.badges.find((b) => b.id === req.params.badgeId);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  if (badge.isSystem) return res.status(400).json({ error: 'System badges cannot be deleted' });
  dbStore.state.badges = dbStore.state.badges.filter((b) => b.id !== badge.id);
  for (const user of dbStore.state.users) {
    if (user.badgeIds?.includes(badge.id)) {
      user.badgeIds = user.badgeIds.filter((id) => id !== badge.id);
    }
  }
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_BADGE_DELETED',
    targetType: 'BADGE',
    targetId: badge.id,
    details: `Deleted platform badge "${badge.label}"`,
  });
  dbStore.save();
  res.json({ ok: true });
});

adminExtrasRouter.put('/users/:userId/badges', (req: AuthenticatedRequest, res) => {
  const user = dbStore.state.users.find((u) => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const validIds = new Set(dbStore.state.badges.map((b) => b.id));
  const incoming = Array.isArray(req.body?.badgeIds) ? (req.body.badgeIds as unknown[]) : [];
  const badgeIds = Array.from(new Set(incoming.map(String).filter((id) => validIds.has(id))));
  user.badgeIds = badgeIds;
  user.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_USER_BADGES_UPDATED',
    targetType: 'USER',
    targetId: user.id,
    details: `Updated badges for @${user.username}: ${badgeIds.join(', ') || 'none'}`,
  });
  dbStore.save();
  const publicUser = dbStore.toPublicUser(user);
  emitGlobal('user:updated', { user: publicUser });
  res.json({ user: publicUser });
});

/* ------------------------------------------------------------------ */
/* Community roadmap ideas                                            */
/* ------------------------------------------------------------------ */

adminExtrasRouter.get('/community/ideas', (_req, res) => {
  const ideas = dbStore.state.communityIdeas
    .map((idea) => ({
      ...idea,
      author: dbStore.state.users.find((u) => u.id === idea.authorId)
        ? dbStore.toPublicUser(dbStore.state.users.find((u) => u.id === idea.authorId)!)
        : null,
    }))
    .sort((a, b) => b.upvoterIds.length - a.upvoterIds.length);
  res.json({ ideas });
});

const IDEA_STATUSES: IdeaStatus[] = ['UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'DECLINED'];

adminExtrasRouter.patch('/community/ideas/:ideaId', (req: AuthenticatedRequest, res) => {
  const idea = dbStore.state.communityIdeas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'Community idea not found' });
  const status = req.body?.status as IdeaStatus | undefined;
  if (status !== undefined) {
    if (!IDEA_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid idea status' });
    idea.status = status;
  }
  if (req.body?.adminResponse !== undefined) {
    idea.adminResponse = String(req.body.adminResponse).trim().slice(0, 600);
  }
  idea.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_IDEA_UPDATED',
    targetType: 'COMMUNITY_IDEA',
    targetId: idea.id,
    details: `Updated roadmap idea "${idea.title}" → ${idea.status}`,
  });
  dbStore.save();
  res.json({ idea });
});

adminExtrasRouter.delete('/community/ideas/:ideaId', (req: AuthenticatedRequest, res) => {
  const idea = dbStore.state.communityIdeas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'Community idea not found' });
  dbStore.state.communityIdeas = dbStore.state.communityIdeas.filter((i) => i.id !== idea.id);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_IDEA_DELETED',
    targetType: 'COMMUNITY_IDEA',
    targetId: idea.id,
    details: `Deleted roadmap idea "${idea.title}"`,
  });
  dbStore.save();
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Support inbox                                                       */
/* ------------------------------------------------------------------ */

adminExtrasRouter.get('/support', (_req, res) => {
  const tickets = [...dbStore.state.supportTickets].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const open = tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
  const urgent = tickets.filter((t) => t.priority === 'URGENT' && t.status !== 'CLOSED').length;
  res.json({ tickets, stats: { total: tickets.length, open, urgent } });
});

const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

adminExtrasRouter.patch('/support/:ticketId', (req: AuthenticatedRequest, res) => {
  const ticket = dbStore.state.supportTickets.find((t) => t.id === req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
  const status = req.body?.status as TicketStatus | undefined;
  const priority = req.body?.priority as TicketPriority | undefined;
  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid ticket status' });
    ticket.status = status;
  }
  if (priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid ticket priority' });
    ticket.priority = priority;
  }
  ticket.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_SUPPORT_TICKET_UPDATED',
    targetType: 'SUPPORT_TICKET',
    targetId: ticket.id,
    details: `Ticket "${ticket.subject}" → ${ticket.status} (${ticket.priority})`,
  });
  dbStore.save();
  emitToUser(ticket.userId, 'support:updated', { ticketId: ticket.id });
  res.json({ ticket });
});

adminExtrasRouter.post('/support/:ticketId/messages', (req: AuthenticatedRequest, res) => {
  const ticket = dbStore.state.supportTickets.find((t) => t.id === req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
  const body = String(req.body?.body || '').trim();
  if (body.length < 1 || body.length > 4000) {
    return res.status(400).json({ error: 'Reply must be 1-4000 characters' });
  }
  const message = {
    id: `stm-${uuidv4().slice(0, 8)}`,
    authorId: req.user!.id,
    authorName: req.user!.displayName,
    isStaff: true,
    body,
    createdAt: new Date().toISOString(),
  };
  ticket.messages.push(message);
  ticket.status = 'WAITING_ON_USER';
  ticket.updatedAt = message.createdAt;
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_SUPPORT_REPLIED',
    targetType: 'SUPPORT_TICKET',
    targetId: ticket.id,
    details: `Staff replied to ticket "${ticket.subject}"`,
  });
  dbStore.save();
  emitToUser(ticket.userId, 'support:updated', { ticketId: ticket.id });
  const notif = dbStore.addNotification({
    userId: ticket.userId,
    type: 'SYSTEM',
    title: 'Support replied to your ticket',
    body: `${ticket.subject}: ${body.slice(0, 140)}`,
    linkUrl: null,
  });
  emitToUser(ticket.userId, 'notification:new', notif);
  res.status(201).json({ ticket, message });
});

/* ------------------------------------------------------------------ */
/* Platega integration                                                 */
/* ------------------------------------------------------------------ */

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

function integrationStatus() {
  const cfg = getPlategaRuntimeConfig();
  return {
    provider: 'Platega',
    providerDocsUrl: 'https://platega.io/',
    configured: isPlategaConfiguredNow(),
    source: cfg.source,
    apiUrl: cfg.apiUrl,
    merchantId: maskValue(cfg.merchantId),
    merchantIdSet: Boolean(cfg.merchantId),
    secretSet: Boolean(cfg.secret),
    webhookSecretSet: Boolean(cfg.webhookSecret),
    sandboxMode: cfg.sandboxMode,
    webhookUrl: getPlategaWebhookUrl(),
    nitroPriceUsd: getNitroPriceUsd(),
    updatedAt: dbStore.state.platformConfig.platega?.updatedAt || null,
    updatedBy: dbStore.state.platformConfig.platega?.updatedBy || null,
    missingVars: [
      ...(cfg.merchantId ? [] : ['merchantId']),
      ...(cfg.secret ? [] : ['secret']),
    ],
  };
}

adminExtrasRouter.get('/integrations', (_req, res) => {
  res.json({ platega: integrationStatus() });
});

adminExtrasRouter.patch('/integrations/platega', (req: AuthenticatedRequest, res) => {
  const current = { ...EMPTY_PLATEGA_CONFIG, ...(dbStore.state.platformConfig.platega || {}) };
  const { merchantId, secret, webhookSecret, apiUrl, sandboxMode, clearCredentials } = req.body as {
    merchantId?: string;
    secret?: string;
    webhookSecret?: string;
    apiUrl?: string;
    sandboxMode?: boolean;
    clearCredentials?: boolean;
  };

  if (clearCredentials) {
    current.merchantId = '';
    current.secret = '';
    current.webhookSecret = '';
  }
  if (merchantId !== undefined) current.merchantId = String(merchantId).trim();
  if (secret !== undefined && !String(secret).startsWith('••')) current.secret = String(secret).trim();
  if (webhookSecret !== undefined && !String(webhookSecret).startsWith('••')) {
    current.webhookSecret = String(webhookSecret).trim();
  }
  if (apiUrl !== undefined) {
    const next = String(apiUrl).trim().replace(/\/+$/, '');
    if (next && !/^https?:\/\//i.test(next)) {
      return res.status(400).json({ error: 'Platega API URL must start with http:// or https://' });
    }
    current.apiUrl = next;
  }
  if (sandboxMode !== undefined) current.sandboxMode = Boolean(sandboxMode);
  current.updatedAt = new Date().toISOString();
  current.updatedBy = req.user!.displayName;

  dbStore.state.platformConfig.platega = current;
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_PLATEGA_CONFIG_UPDATED',
    targetType: 'INTEGRATION',
    targetId: 'platega',
    details: `Updated Platega integration (merchant ${maskValue(current.merchantId) || 'unset'}, sandbox: ${current.sandboxMode})`,
  });
  dbStore.save();
  res.json({ platega: integrationStatus() });
});

adminExtrasRouter.post('/integrations/platega/test', async (_req: AuthenticatedRequest, res) => {
  const cfg = getPlategaRuntimeConfig();
  if (!cfg.merchantId || !cfg.secret) {
    return res.status(400).json({
      ok: false,
      error: 'Merchant ID and secret are required before testing the connection.',
      missingVars: integrationStatus().missingVars,
    });
  }
  const startedAt = performance.now();
  try {
    const response = await fetch(cfg.apiUrl, {
      method: 'GET',
      headers: { 'X-MerchantId': cfg.merchantId, 'X-Secret': cfg.secret },
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    return res.json({
      ok: response.status < 500,
      reachable: true,
      httpStatus: response.status,
      latencyMs,
      apiUrl: cfg.apiUrl,
      note:
        response.status === 404
          ? 'Host reachable. A 404 on the API root is normal — transaction endpoints live under /transaction.'
          : `Platega responded with HTTP ${response.status}.`,
    });
  } catch (err) {
    return res.json({
      ok: false,
      reachable: false,
      latencyMs: Math.round(performance.now() - startedAt),
      apiUrl: cfg.apiUrl,
      error: (err as Error).message,
    });
  }
});

/* ------------------------------------------------------------------ */
/* Community database explorer (admin managed)                         */
/* ------------------------------------------------------------------ */

adminExtrasRouter.post('/workspace-assets/databases', (req: AuthenticatedRequest, res) => {
  const serverId = String(req.body?.serverId || '');
  const server = dbStore.state.servers.find((s) => s.id === serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const name = String(req.body?.name || '').trim();
  if (name.length < 1 || name.length > 80) return res.status(400).json({ error: 'Table name must be 1-80 characters' });
  const rawColumns = Array.isArray(req.body?.columns) ? req.body.columns : [];
  const columns: ServerDatabaseColumn[] = rawColumns.slice(0, 16).map((col: Record<string, unknown>, idx: number) => ({
    id: `col_${idx + 1}_${uuidv4().slice(0, 6)}`,
    name: String(col.name || `Column ${idx + 1}`).slice(0, 64),
    type: (['text', 'number', 'status', 'checkbox', 'date', 'url'].includes(String(col.type))
      ? String(col.type)
      : 'text') as ServerDatabaseColumn['type'],
    options: String(col.type) === 'status' ? ['Planned', 'In Progress', 'Shipped'] : undefined,
  }));
  if (columns.length === 0) {
    columns.push({ id: `col_1_${uuidv4().slice(0, 6)}`, name: 'Name', type: 'text' });
  }
  const now = new Date().toISOString();
  const table = {
    id: `srvdb-${uuidv4().slice(0, 8)}`,
    serverId,
    name,
    description: String(req.body?.description || '').trim().slice(0, 300),
    icon: String(req.body?.icon || 'table').slice(0, 32),
    columns,
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.serverDatabases.push(table);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DB_CREATED',
    targetType: 'SERVER_DATABASE',
    targetId: table.id,
    details: `Admin created community database "${table.name}"`,
  });
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId: table.id });
  res.status(201).json({ table });
});

function coerceCells(
  columns: ServerDatabaseColumn[],
  raw: Record<string, unknown>
): Record<string, string | number | boolean> {
  const cells: Record<string, string | number | boolean> = {};
  for (const col of columns) {
    const val = raw[col.id];
    if (col.type === 'checkbox') cells[col.id] = Boolean(val);
    else if (col.type === 'number') {
      const n = Number(val);
      cells[col.id] = Number.isFinite(n) ? n : 0;
    } else if (col.type === 'status') {
      cells[col.id] = String(val ?? col.options?.[0] ?? 'Planned').slice(0, 64);
    } else {
      cells[col.id] = val === undefined || val === null ? '' : String(val).slice(0, 500);
    }
  }
  return cells;
}

adminExtrasRouter.get('/workspace-assets/databases/:tableId', (req, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const server = dbStore.state.servers.find((s) => s.id === table.serverId);
  const rows = dbStore.state.serverDatabaseRows
    .filter((r) => r.tableId === table.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ table, server: server ? { id: server.id, name: server.name } : null, rows });
});

adminExtrasRouter.get('/workspace-assets/databases/:tableId/rows', (req, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const rows = dbStore.state.serverDatabaseRows
    .filter((r) => r.tableId === table.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ table, rows });
});

adminExtrasRouter.post('/workspace-assets/databases/:tableId/rows', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const now = new Date().toISOString();
  const row: ServerDatabaseRow = {
    id: `srvrow-${uuidv4().slice(0, 8)}`,
    tableId: table.id,
    serverId: table.serverId,
    cells: coerceCells(table.columns, (req.body?.cells || {}) as Record<string, unknown>),
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.serverDatabaseRows.push(row);
  table.updatedAt = now;
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.status(201).json({ row });
});

adminExtrasRouter.patch('/workspace-assets/databases/:tableId/rows/:rowId', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  const row = dbStore.state.serverDatabaseRows.find(
    (r) => r.id === req.params.rowId && r.tableId === req.params.tableId
  );
  if (!table || !row) return res.status(404).json({ error: 'Database row not found' });
  const incoming = (req.body?.cells || {}) as Record<string, unknown>;
  for (const col of table.columns) {
    if (incoming[col.id] === undefined) continue;
    const coerced = coerceCells([col], { [col.id]: incoming[col.id] });
    row.cells[col.id] = coerced[col.id];
  }
  row.updatedAt = new Date().toISOString();
  table.updatedAt = row.updatedAt;
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.json({ row });
});

adminExtrasRouter.delete('/workspace-assets/databases/:tableId/rows/:rowId', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const before = dbStore.state.serverDatabaseRows.length;
  dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter(
    (r) => !(r.id === req.params.rowId && r.tableId === table.id)
  );
  if (dbStore.state.serverDatabaseRows.length === before) {
    return res.status(404).json({ error: 'Database row not found' });
  }
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.json({ ok: true });
});

adminExtrasRouter.patch('/workspace-assets/databases/:tableId', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  if (req.body?.name !== undefined) table.name = String(req.body.name).trim().slice(0, 80) || table.name;
  if (req.body?.description !== undefined) table.description = String(req.body.description).trim().slice(0, 300);
  const addColumn = req.body?.addColumn as { name?: string; type?: string } | undefined;
  if (addColumn) {
    if (table.columns.length >= 16) return res.status(400).json({ error: 'Maximum 16 columns per table' });
    const type = ['text', 'number', 'status', 'checkbox', 'date', 'url'].includes(String(addColumn.type))
      ? (String(addColumn.type) as ServerDatabaseColumn['type'])
      : 'text';
    table.columns.push({
      id: `col_${uuidv4().slice(0, 8)}`,
      name: String(addColumn.name || 'New Column').slice(0, 64),
      type,
      options: type === 'status' ? ['Planned', 'In Progress', 'Shipped'] : undefined,
    });
  }
  const renameColumn = req.body?.renameColumn as { id?: string; name?: string; options?: unknown } | undefined;
  if (renameColumn?.id) {
    const column = table.columns.find((c) => c.id === renameColumn.id);
    if (!column) return res.status(404).json({ error: 'Column not found' });
    if (renameColumn.name !== undefined) column.name = String(renameColumn.name).trim().slice(0, 64) || column.name;
    if (Array.isArray(renameColumn.options) && column.type === 'status') {
      const options = renameColumn.options.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 24);
      if (options.length) column.options = options;
    }
  }
  table.updatedAt = new Date().toISOString();
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.json({ table });
});

adminExtrasRouter.delete('/workspace-assets/databases/:tableId/columns/:columnId', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  if (table.columns.length <= 1) return res.status(400).json({ error: 'A database needs at least one column' });
  const column = table.columns.find((c) => c.id === req.params.columnId);
  if (!column) return res.status(404).json({ error: 'Column not found' });
  table.columns = table.columns.filter((c) => c.id !== column.id);
  for (const row of dbStore.state.serverDatabaseRows) {
    if (row.tableId !== table.id) continue;
    delete row.cells[column.id];
    row.updatedAt = new Date().toISOString();
  }
  table.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    serverId: table.serverId,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DB_COLUMN_DELETED',
    targetType: 'SERVER_DATABASE',
    targetId: table.id,
    details: `Deleted column "${column.name}" from database "${table.name}"`,
  });
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.json({ table });
});

adminExtrasRouter.post('/workspace-assets/databases/:tableId/duplicate', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const now = new Date().toISOString();
  const copy = {
    ...table,
    id: `srvdb-${uuidv4().slice(0, 8)}`,
    name: `${table.name} copy`.slice(0, 80),
    columns: table.columns.map((col) => ({ ...col, id: `col_${uuidv4().slice(0, 8)}` })),
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.serverDatabases.push(copy);
  const sourceRows = dbStore.state.serverDatabaseRows.filter((r) => r.tableId === table.id);
  for (const row of sourceRows) {
    const cells: Record<string, string | number | boolean> = {};
    table.columns.forEach((oldCol, index) => {
      cells[copy.columns[index].id] = row.cells[oldCol.id] ?? '';
    });
    dbStore.state.serverDatabaseRows.push({
      id: `srvrow-${uuidv4().slice(0, 8)}`,
      tableId: copy.id,
      serverId: copy.serverId,
      cells,
      createdBy: req.user!.id,
      createdAt: now,
      updatedAt: now,
    });
  }
  dbStore.addAuditLog({
    serverId: copy.serverId,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DB_DUPLICATED',
    targetType: 'SERVER_DATABASE',
    targetId: copy.id,
    details: `Duplicated database "${table.name}" → "${copy.name}" (${sourceRows.length} row(s))`,
  });
  dbStore.save();
  emitToServer(copy.serverId, 'serverdb:updated', { serverId: copy.serverId, tableId: copy.id });
  res.status(201).json({ table: copy });
});

adminExtrasRouter.post('/workspace-assets/databases/:tableId/import', (req: AuthenticatedRequest, res) => {
  const table = dbStore.state.serverDatabases.find((t) => t.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });
  const incoming = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (incoming.length === 0) return res.status(400).json({ error: 'No rows supplied for import.' });
  if (incoming.length > 5000) return res.status(400).json({ error: 'Import is limited to 5000 rows per request.' });

  const now = new Date().toISOString();
  let imported = 0;
  for (const raw of incoming as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const normalized: Record<string, unknown> = {};
    for (const col of table.columns) {
      normalized[col.id] = raw[col.id] ?? raw[col.name];
    }
    dbStore.state.serverDatabaseRows.push({
      id: `srvrow-${uuidv4().slice(0, 8)}`,
      tableId: table.id,
      serverId: table.serverId,
      cells: coerceCells(table.columns, normalized),
      createdBy: req.user!.id,
      createdAt: now,
      updatedAt: now,
    });
    imported += 1;
  }
  table.updatedAt = now;
  dbStore.addAuditLog({
    serverId: table.serverId,
    actorId: req.user!.id,
    action: 'ADMIN_SERVER_DB_IMPORTED',
    targetType: 'SERVER_DATABASE',
    targetId: table.id,
    details: `Imported ${imported} row(s) into database "${table.name}"`,
  });
  dbStore.save();
  emitToServer(table.serverId, 'serverdb:updated', { serverId: table.serverId, tableId: table.id });
  res.status(201).json({ imported, table });
});
