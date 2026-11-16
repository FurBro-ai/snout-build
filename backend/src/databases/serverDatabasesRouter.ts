import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { PERMISSIONS } from '../../../shared/constants.ts';
import type {
  BookmarkItem,
  ScheduledEvent,
  ServerDatabaseColumn,
  ServerDatabaseRow,
  ServerDatabaseTable,
} from '../../../shared/types.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { checkServerPermission, getMember, isMemberTimedOut } from '../permissions/permissionService.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToServer } from '../websocket/socketGateway.ts';

export const serverDatabasesRouter = Router();

const columnSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(64),
  type: z.enum(['text', 'number', 'status', 'checkbox', 'date', 'url']),
  options: z.array(z.string().min(1).max(40)).max(12).optional(),
});

const createTableSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  icon: z.string().max(32).optional(),
  columns: z.array(columnSchema).min(1).max(16),
});

function ensureServerAccess(serverId: string, userId: string): boolean {
  const srv = dbStore.state.servers.find((s) => s.id === serverId);
  if (!srv) return false;
  if (srv.ownerId === userId) return true;
  return Boolean(getMember(serverId, userId));
}

// --- Built-in Server Collaborative Databases ---

serverDatabasesRouter.get('/servers/:serverId/databases', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Join this server to view its built-in databases' });
  }
  const tables = dbStore.state.serverDatabases.filter((t) => t.serverId === serverId);
  const rows = dbStore.state.serverDatabaseRows.filter((r) => r.serverId === serverId);
  res.json({ tables, rows });
});

serverDatabasesRouter.post('/servers/:serverId/databases', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const canManage =
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER);
  if (!canManage) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission to create database tables' });
  }

  const parsed = createTableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid table definition', details: parsed.error.flatten() });
  }

  const now = new Date().toISOString();
  const columns: ServerDatabaseColumn[] = parsed.data.columns.map((col, idx) => ({
    id: col.id?.trim() || `col_${idx + 1}_${uuidv4().slice(0, 6)}`,
    name: col.name.trim(),
    type: col.type,
    options:
      col.type === 'status'
        ? col.options && col.options.length > 0
          ? col.options
          : ['Todo', 'In Progress', 'Done']
        : undefined,
  }));

  const table: ServerDatabaseTable = {
    id: `srvdb-${uuidv4().slice(0, 8)}`,
    serverId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || '',
    icon: parsed.data.icon?.trim() || 'table',
    columns,
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };

  dbStore.state.serverDatabases.push(table);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'SERVER_DB_TABLE_CREATED',
    targetType: 'DATABASE_TABLE',
    targetId: table.id,
    details: `Created built-in database table "${table.name}" (${columns.length} columns)`,
  });
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId: table.id });
  res.status(201).json({ table });
});

serverDatabasesRouter.patch('/servers/:serverId/databases/:tableId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, tableId } = req.params;
  const table = dbStore.state.serverDatabases.find((t) => t.id === tableId && t.serverId === serverId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });

  const canManage =
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER);
  if (!canManage) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }

  const { name, description, addColumn } = req.body as {
    name?: string;
    description?: string;
    addColumn?: z.infer<typeof columnSchema>;
  };

  if (name && name.trim()) table.name = name.trim().slice(0, 80);
  if (description !== undefined) table.description = String(description).trim().slice(0, 300);

  if (addColumn) {
    const colParsed = columnSchema.safeParse(addColumn);
    if (!colParsed.success) {
      return res.status(400).json({ error: 'Invalid column definition' });
    }
    if (table.columns.length >= 16) {
      return res.status(400).json({ error: 'Maximum 16 columns per table' });
    }
    table.columns.push({
      id: `col_${uuidv4().slice(0, 8)}`,
      name: colParsed.data.name.trim(),
      type: colParsed.data.type,
      options:
        colParsed.data.type === 'status'
          ? colParsed.data.options && colParsed.data.options.length > 0
            ? colParsed.data.options
            : ['Todo', 'In Progress', 'Done']
          : undefined,
    });
  }

  table.updatedAt = new Date().toISOString();
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId: table.id });
  res.json({ table });
});

serverDatabasesRouter.delete('/servers/:serverId/databases/:tableId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, tableId } = req.params;
  const table = dbStore.state.serverDatabases.find((t) => t.id === tableId && t.serverId === serverId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });

  const canManage =
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER);
  if (!canManage) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
  }

  dbStore.state.serverDatabases = dbStore.state.serverDatabases.filter((t) => t.id !== tableId);
  dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter((r) => r.tableId !== tableId);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'SERVER_DB_TABLE_DELETED',
    targetType: 'DATABASE_TABLE',
    targetId: tableId,
    details: `Deleted built-in database table "${table.name}"`,
  });
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId });
  res.json({ ok: true });
});

serverDatabasesRouter.post('/servers/:serverId/databases/:tableId/rows', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, tableId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const member = getMember(serverId, req.user!.id);
  if (isMemberTimedOut(member)) {
    return res.status(403).json({ error: 'Timed-out members cannot add database rows' });
  }
  const table = dbStore.state.serverDatabases.find((t) => t.id === tableId && t.serverId === serverId);
  if (!table) return res.status(404).json({ error: 'Database table not found' });

  const rawCells = (req.body?.cells || {}) as Record<string, unknown>;
  const cells: Record<string, string | number | boolean> = {};
  for (const col of table.columns) {
    const val = rawCells[col.id];
    if (col.type === 'checkbox') {
      cells[col.id] = Boolean(val);
    } else if (col.type === 'number') {
      const n = Number(val);
      cells[col.id] = Number.isFinite(n) ? n : 0;
    } else if (col.type === 'status') {
      const str = String(val || col.options?.[0] || 'Todo').slice(0, 64);
      cells[col.id] = str;
    } else {
      cells[col.id] = val !== undefined && val !== null ? String(val).slice(0, 500) : '';
    }
  }

  const now = new Date().toISOString();
  const row: ServerDatabaseRow = {
    id: `srvrow-${uuidv4().slice(0, 8)}`,
    tableId,
    serverId,
    cells,
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.serverDatabaseRows.push(row);
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId });
  res.status(201).json({ row });
});

serverDatabasesRouter.patch('/servers/:serverId/databases/:tableId/rows/:rowId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, tableId, rowId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const table = dbStore.state.serverDatabases.find((t) => t.id === tableId && t.serverId === serverId);
  const row = dbStore.state.serverDatabaseRows.find(
    (r) => r.id === rowId && r.tableId === tableId && r.serverId === serverId
  );
  if (!table || !row) return res.status(404).json({ error: 'Row not found' });

  const incoming = (req.body?.cells || {}) as Record<string, unknown>;
  for (const col of table.columns) {
    if (incoming[col.id] === undefined) continue;
    const val = incoming[col.id];
    if (col.type === 'checkbox') {
      row.cells[col.id] = Boolean(val);
    } else if (col.type === 'number') {
      const n = Number(val);
      row.cells[col.id] = Number.isFinite(n) ? n : 0;
    } else {
      row.cells[col.id] = String(val ?? '').slice(0, 500);
    }
  }
  row.updatedAt = new Date().toISOString();
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId });
  res.json({ row });
});

serverDatabasesRouter.delete('/servers/:serverId/databases/:tableId/rows/:rowId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, tableId, rowId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const row = dbStore.state.serverDatabaseRows.find(
    (r) => r.id === rowId && r.tableId === tableId && r.serverId === serverId
  );
  if (!row) return res.status(404).json({ error: 'Row not found' });

  const canManage =
    row.createdBy === req.user!.id ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_MESSAGES) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS);
  if (!canManage) {
    return res.status(403).json({ error: 'Only the row author or moderators can delete this row' });
  }

  dbStore.state.serverDatabaseRows = dbStore.state.serverDatabaseRows.filter((r) => r.id !== rowId);
  dbStore.save();
  emitToServer(serverId, 'serverdb:updated', { serverId, tableId });
  res.json({ ok: true });
});

// --- Server Scheduled Events ---

serverDatabasesRouter.get('/servers/:serverId/events', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const events = dbStore.state.scheduledEvents
    .filter((e) => e.serverId === serverId)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  res.json({ events });
});

serverDatabasesRouter.post('/servers/:serverId/events', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const canManage =
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER);
  if (!canManage) {
    return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission to schedule events' });
  }

  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const startsAtRaw = String(req.body?.startsAt || '');
  const channelId = req.body?.channelId ? String(req.body.channelId) : null;
  const locationLabel = String(req.body?.locationLabel || 'Voice Lounge').trim();

  if (title.length < 2 || title.length > 100) {
    return res.status(400).json({ error: 'Event title must be 2-100 characters' });
  }
  const startsAtDate = new Date(startsAtRaw);
  if (Number.isNaN(startsAtDate.getTime())) {
    return res.status(400).json({ error: 'Valid event start date/time required' });
  }

  const ev: ScheduledEvent = {
    id: `evt-${uuidv4().slice(0, 8)}`,
    serverId,
    channelId,
    title,
    description: description.slice(0, 500),
    startsAt: startsAtDate.toISOString(),
    locationLabel: locationLabel.slice(0, 80) || 'Voice Lounge',
    status: 'SCHEDULED',
    interestedUserIds: [req.user!.id],
    createdBy: req.user!.id,
    createdAt: new Date().toISOString(),
  };

  dbStore.state.scheduledEvents.push(ev);
  dbStore.addAuditLog({
    serverId,
    actorId: req.user!.id,
    action: 'EVENT_CREATED',
    targetType: 'EVENT',
    targetId: ev.id,
    details: `Scheduled event "${ev.title}"`,
  });
  dbStore.save();
  emitToServer(serverId, 'events:updated', { serverId });
  res.status(201).json({ event: ev });
});

serverDatabasesRouter.post('/servers/:serverId/events/:eventId/rsvp', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, eventId } = req.params;
  if (!ensureServerAccess(serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Not a member of this server' });
  }
  const ev = dbStore.state.scheduledEvents.find((e) => e.id === eventId && e.serverId === serverId);
  if (!ev) return res.status(404).json({ error: 'Scheduled event not found' });

  const idx = ev.interestedUserIds.indexOf(req.user!.id);
  if (idx >= 0) {
    ev.interestedUserIds.splice(idx, 1);
  } else {
    ev.interestedUserIds.push(req.user!.id);
  }
  dbStore.save();
  emitToServer(serverId, 'events:updated', { serverId });
  res.json({ event: ev });
});

serverDatabasesRouter.delete('/servers/:serverId/events/:eventId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { serverId, eventId } = req.params;
  const ev = dbStore.state.scheduledEvents.find((e) => e.id === eventId && e.serverId === serverId);
  if (!ev) return res.status(404).json({ error: 'Scheduled event not found' });

  const canManage =
    ev.createdBy === req.user!.id ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_CHANNELS) ||
    checkServerPermission(serverId, req.user!.id, PERMISSIONS.MANAGE_SERVER);
  if (!canManage) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  dbStore.state.scheduledEvents = dbStore.state.scheduledEvents.filter((e) => e.id !== eventId);
  dbStore.save();
  emitToServer(serverId, 'events:updated', { serverId });
  res.json({ ok: true });
});

// --- Personal Saved Message Bookmarks ---

serverDatabasesRouter.get('/bookmarks', requireAuth, (req: AuthenticatedRequest, res) => {
  const bookmarks = dbStore.state.bookmarks
    .filter((b) => b.userId === req.user!.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ bookmarks });
});

serverDatabasesRouter.post('/bookmarks', requireAuth, (req: AuthenticatedRequest, res) => {
  const messageId = String(req.body?.messageId || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (!messageId) return res.status(400).json({ error: 'messageId required' });

  const msg = dbStore.state.messages.find((m) => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  if (msg.serverId && !ensureServerAccess(msg.serverId, req.user!.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (msg.threadId) {
    const thread = dbStore.state.directThreads.find((t) => t.id === msg.threadId);
    if (!thread || !thread.participantIds.includes(req.user!.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const existing = dbStore.state.bookmarks.find(
    (b) => b.userId === req.user!.id && b.messageId === messageId
  );
  if (existing) {
    if (note) existing.note = note;
    dbStore.save();
    return res.json({ bookmark: existing, alreadySaved: true });
  }

  const author = dbStore.state.users.find((u) => u.id === msg.authorId);
  const channel = msg.channelId
    ? dbStore.state.channels.find((c) => c.id === msg.channelId)
    : null;
  const server = msg.serverId
    ? dbStore.state.servers.find((s) => s.id === msg.serverId)
    : null;

  const bookmark: BookmarkItem = {
    id: `bm-${uuidv4().slice(0, 8)}`,
    userId: req.user!.id,
    messageId: msg.id,
    channelId: msg.channelId,
    threadId: msg.threadId,
    serverId: msg.serverId,
    authorName: author?.displayName || 'Unknown',
    channelName: channel ? `${server?.name || 'Server'} · #${channel.name}` : 'Direct Message',
    content: msg.content.slice(0, 400) || '[Attachment]',
    note,
    createdAt: new Date().toISOString(),
  };

  dbStore.state.bookmarks.unshift(bookmark);
  dbStore.save();
  res.status(201).json({ bookmark });
});

serverDatabasesRouter.patch('/bookmarks/:bookmarkId', requireAuth, (req: AuthenticatedRequest, res) => {
  const bm = dbStore.state.bookmarks.find(
    (b) => b.id === req.params.bookmarkId && b.userId === req.user!.id
  );
  if (!bm) return res.status(404).json({ error: 'Bookmark not found' });
  bm.note = String(req.body?.note || '').trim().slice(0, 300);
  dbStore.save();
  res.json({ bookmark: bm });
});

serverDatabasesRouter.delete('/bookmarks/:bookmarkId', requireAuth, (req: AuthenticatedRequest, res) => {
  const before = dbStore.state.bookmarks.length;
  dbStore.state.bookmarks = dbStore.state.bookmarks.filter(
    (b) => !(b.id === req.params.bookmarkId && b.userId === req.user!.id)
  );
  if (dbStore.state.bookmarks.length === before) {
    return res.status(404).json({ error: 'Bookmark not found' });
  }
  dbStore.save();
  res.json({ ok: true });
});

// --- Global Workspace Search (Messages & Server Database Rows) ---

serverDatabasesRouter.get('/search', requireAuth, (req: AuthenticatedRequest, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) {
    return res.json({ messages: [], databaseRows: [] });
  }

  const userServerIds = new Set(
    dbStore.state.servers
      .filter((s) => s.ownerId === req.user!.id || Boolean(getMember(s.id, req.user!.id)))
      .map((s) => s.id)
  );
  const userThreadIds = new Set(
    dbStore.state.directThreads
      .filter((t) => t.participantIds.includes(req.user!.id))
      .map((t) => t.id)
  );

  const matchedMessages = dbStore.state.messages
    .filter((m) => {
      const hasAccess =
        (m.serverId && userServerIds.has(m.serverId)) ||
        (m.threadId && userThreadIds.has(m.threadId));
      return hasAccess && m.content.toLowerCase().includes(q);
    })
    .slice(-25)
    .reverse()
    .map((m) => {
      const author = dbStore.state.users.find((u) => u.id === m.authorId);
      const ch = m.channelId ? dbStore.state.channels.find((c) => c.id === m.channelId) : null;
      const srv = m.serverId ? dbStore.state.servers.find((s) => s.id === m.serverId) : null;
      return {
        id: m.id,
        channelId: m.channelId,
        threadId: m.threadId,
        serverId: m.serverId,
        channelName: ch ? `#${ch.name}` : 'Direct Message',
        serverName: srv?.name || null,
        authorName: author?.displayName || 'Unknown',
        content: m.content.slice(0, 180),
        createdAt: m.createdAt,
      };
    });

  const matchedDbRows = dbStore.state.serverDatabaseRows
    .filter((r) => userServerIds.has(r.serverId) && JSON.stringify(r.cells).toLowerCase().includes(q))
    .slice(0, 20)
    .map((r) => {
      const table = dbStore.state.serverDatabases.find((t) => t.id === r.tableId);
      const srv = dbStore.state.servers.find((s) => s.id === r.serverId);
      const firstVal = Object.values(r.cells).find((v) => typeof v === 'string' && v.trim()) || 'Database record';
      return {
        rowId: r.id,
        tableId: r.tableId,
        tableName: table?.name || 'Database',
        serverId: r.serverId,
        serverName: srv?.name || 'Server',
        preview: String(firstVal).slice(0, 140),
      };
    });

  res.json({ messages: matchedMessages, databaseRows: matchedDbRows });
});
