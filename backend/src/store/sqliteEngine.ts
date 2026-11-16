import { createRequire } from 'module';
const requireFn = createRequire(import.meta.url);
let Database: any = null;
try {
  Database = requireFn('better-sqlite3');
} catch {
  Database = null;
}
import fs from 'fs';
import path from 'path';
import type {
  DatabaseEngineSummary,
  DatabaseTableMeta,
  SqlQueryResult,
} from '../../../shared/types.ts';
import type { DatabaseState } from './dbStore.ts';

const DATA_DIR = process.env.SNOUT_DATA_DIR
  ? path.resolve(process.env.SNOUT_DATA_DIR)
  : process.env.VERCEL
    ? path.join('/tmp', 'snout-data')
    : path.resolve(process.cwd(), 'data');
const SQLITE_FILE = path.join(DATA_DIR, 'snout.db');
const FIREBASE_CONFIG_FILE = path.resolve(process.cwd(), 'firebase-applet-config.json');

const ALLOWED_RELATIONAL_TABLES = [
  'users',
  'servers',
  'channels',
  'members',
  'messages',
  'bots',
  'payments',
  'subscriptions',
  'audit_logs',
  'server_databases',
  'server_database_rows',
  'bookmarks',
  'scheduled_events',
  'badges',
  'community_ideas',
  'support_tickets',
  'voice_servers',
] as const;

type AllowedTable = (typeof ALLOWED_RELATIONAL_TABLES)[number];

let dbInstance: any | null = null;

function readFirestoreDbId(): string {
  try {
    if (fs.existsSync(FIREBASE_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf-8')) as {
        firestoreDatabaseId?: string;
      };
      if (cfg.firestoreDatabaseId) return cfg.firestoreDatabaseId;
    }
  } catch {
    // ignore
  }
  return 'ai-studio-e12cc442-be1e-4b3b-9770-84e078d9f4cc';
}

function getDb(): any {
  if (!Database) throw new Error('SQLite engine unavailable on this platform');
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new Database(SQLITE_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL DEFAULT 2,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      platform_role TEXT NOT NULL,
      is_nitro INTEGER NOT NULL DEFAULT 0,
      is_bot INTEGER NOT NULL DEFAULT 0,
      is_suspended INTEGER NOT NULL DEFAULT 0,
      email_verified INTEGER NOT NULL DEFAULT 0,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      boost_tier INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      type TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      nickname TEXT,
      role_ids_json TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_members_server_user ON members(server_id, user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      thread_id TEXT,
      server_id TEXT,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      bot_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      installed_count INTEGER NOT NULL DEFAULT 0,
      commands_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      price_usd REAL NOT NULL,
      current_period_end TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      actor_id TEXT NOT NULL,
      actor_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS server_databases (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      columns_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_srvdb_server ON server_databases(server_id);

    CREATE TABLE IF NOT EXISTS server_database_rows (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      cells_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_srvdb_rows_table ON server_database_rows(table_id);

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel_id TEXT,
      thread_id TEXT,
      server_id TEXT,
      author_name TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      content TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

    CREATE TABLE IF NOT EXISTS scheduled_events (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      channel_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      location_label TEXT NOT NULL,
      status TEXT NOT NULL,
      interested_user_ids_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_server ON scheduled_events(server_id, starts_at);

    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      upvoter_ids_json TEXT NOT NULL,
      admin_response TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON community_ideas(status);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

    CREATE TABLE IF NOT EXISTS voice_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      turn_port INTEGER NOT NULL,
      region_label TEXT NOT NULL,
      region_code TEXT NOT NULL,
      region_group TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      capacity INTEGER NOT NULL DEFAULT 250,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      turn_secret_set INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_region ON voice_servers(region_group, status);
  `);

  dbInstance = db;
  return db;
}

export function loadStateFromSqlite(): DatabaseState | null {
  if (!Database) return null;
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT payload FROM state_snapshot WHERE id = 1')
      .get() as { payload?: string } | undefined;
    if (!row?.payload) return null;
    return JSON.parse(row.payload) as DatabaseState;
  } catch (err) {
    console.error('Failed to read snapshot from built-in SQLite DB:', err);
    return null;
  }
}

export function syncStateToSqlite(state: DatabaseState): void {
  if (!Database) return;
  const db = getDb();
  const now = new Date().toISOString();

  const runSync = db.transaction((s: DatabaseState) => {
    db.prepare(
      `INSERT INTO state_snapshot (id, schema_version, payload, updated_at)
       VALUES (1, 2, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    ).run(JSON.stringify(s), now);

    // Clear and batch-insert relational mirrors so direct SQL inspection always stays 100% live
    for (const table of ALLOWED_RELATIONAL_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    const insUser = db.prepare(
      `INSERT INTO users (id, username, display_name, email, platform_role, is_nitro, is_bot, is_suspended, email_verified, two_factor_enabled, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of s.users) {
      insUser.run(
        u.id,
        u.username,
        u.displayName,
        u.email,
        u.platformRole,
        u.isNitro ? 1 : 0,
        u.isBot ? 1 : 0,
        u.isSuspended ? 1 : 0,
        u.emailVerified ? 1 : 0,
        u.twoFactorEnabled ? 1 : 0,
        u.status,
        u.createdAt,
        u.updatedAt
      );
    }

    const insServer = db.prepare(
      `INSERT INTO servers (id, name, description, owner_id, is_public, boost_tier, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const srv of s.servers) {
      insServer.run(
        srv.id,
        srv.name,
        srv.description,
        srv.ownerId,
        srv.isPublic ? 1 : 0,
        srv.boostTier,
        srv.createdAt
      );
    }

    const insChan = db.prepare(
      `INSERT INTO channels (id, server_id, category_id, name, topic, type, is_private, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ch of s.channels) {
      insChan.run(
        ch.id,
        ch.serverId,
        ch.categoryId,
        ch.name,
        ch.topic,
        ch.type,
        ch.isPrivate ? 1 : 0,
        ch.position,
        ch.createdAt
      );
    }

    const insMem = db.prepare(
      `INSERT INTO members (id, server_id, user_id, nickname, role_ids_json, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const m of s.members) {
      insMem.run(
        m.id,
        m.serverId,
        m.userId,
        m.nickname,
        JSON.stringify(m.roleIds || []),
        m.joinedAt
      );
    }

    const insMsg = db.prepare(
      `INSERT INTO messages (id, channel_id, thread_id, server_id, author_id, content, is_pinned, is_edited, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const msg of s.messages) {
      insMsg.run(
        msg.id,
        msg.channelId,
        msg.threadId,
        msg.serverId,
        msg.authorId,
        msg.content,
        msg.isPinned ? 1 : 0,
        msg.isEdited ? 1 : 0,
        msg.createdAt,
        msg.updatedAt
      );
    }

    const insBot = db.prepare(
      `INSERT INTO bots (id, owner_id, bot_user_id, name, description, token_prefix, installed_count, commands_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of s.bots) {
      insBot.run(
        b.id,
        b.ownerId,
        b.botUserId,
        b.name,
        b.description,
        b.tokenPrefix,
        b.installedServerIds?.length || 0,
        b.slashCommands?.length || 0,
        b.createdAt
      );
    }

    const insPay = db.prepare(
      `INSERT INTO payments (id, order_id, user_id, amount, currency, status, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of s.payments) {
      insPay.run(
        p.id,
        p.orderId,
        p.userId,
        p.amount,
        p.currency,
        p.status,
        p.createdAt,
        p.confirmedAt
      );
    }

    const insSub = db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, price_usd, current_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const sub of s.subscriptions) {
      insSub.run(
        sub.id,
        sub.userId,
        sub.planId,
        sub.status,
        sub.priceUsd,
        sub.currentPeriodEnd,
        sub.updatedAt
      );
    }

    const insAudit = db.prepare(
      `INSERT INTO audit_logs (id, server_id, actor_id, actor_name, action, target_type, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const log of s.auditLogs) {
      insAudit.run(
        log.id,
        log.serverId,
        log.actorId,
        log.actorName || null,
        log.action,
        log.targetType,
        log.targetId,
        log.details,
        log.createdAt
      );
    }

    const insSrvDb = db.prepare(
      `INSERT INTO server_databases (id, server_id, name, description, icon, columns_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const tbl of s.serverDatabases || []) {
      insSrvDb.run(
        tbl.id,
        tbl.serverId,
        tbl.name,
        tbl.description,
        tbl.icon,
        JSON.stringify(tbl.columns || []),
        tbl.createdBy,
        tbl.createdAt,
        tbl.updatedAt
      );
    }

    const insSrvRow = db.prepare(
      `INSERT INTO server_database_rows (id, table_id, server_id, cells_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of s.serverDatabaseRows || []) {
      insSrvRow.run(
        row.id,
        row.tableId,
        row.serverId,
        JSON.stringify(row.cells || {}),
        row.createdBy,
        row.createdAt,
        row.updatedAt
      );
    }

    const insBm = db.prepare(
      `INSERT INTO bookmarks (id, user_id, message_id, channel_id, thread_id, server_id, author_name, channel_name, content, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const bm of s.bookmarks || []) {
      insBm.run(
        bm.id,
        bm.userId,
        bm.messageId,
        bm.channelId,
        bm.threadId,
        bm.serverId,
        bm.authorName,
        bm.channelName,
        bm.content,
        bm.note,
        bm.createdAt
      );
    }

    const insEvt = db.prepare(
      `INSERT INTO scheduled_events (id, server_id, channel_id, title, description, starts_at, location_label, status, interested_user_ids_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ev of s.scheduledEvents || []) {
      insEvt.run(
        ev.id,
        ev.serverId,
        ev.channelId,
        ev.title,
        ev.description,
        ev.startsAt,
        ev.locationLabel,
        ev.status,
        JSON.stringify(ev.interestedUserIds || []),
        ev.createdBy,
        ev.createdAt
      );
    }

    const insBadge = db.prepare(
      `INSERT INTO badges (id, label, description, color, icon, priority, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const badge of s.badges || []) {
      insBadge.run(
        badge.id,
        badge.label,
        badge.description,
        badge.color,
        badge.icon,
        badge.priority,
        badge.isSystem ? 1 : 0,
        badge.createdAt
      );
    }

    const insIdea = db.prepare(
      `INSERT INTO community_ideas (id, title, description, category, status, author_id, author_name, upvoter_ids_json, admin_response, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const idea of s.communityIdeas || []) {
      insIdea.run(
        idea.id,
        idea.title,
        idea.description,
        idea.category,
        idea.status,
        idea.authorId,
        idea.authorName,
        JSON.stringify(idea.upvoterIds || []),
        idea.adminResponse,
        idea.createdAt,
        idea.updatedAt
      );
    }

    const insTicket = db.prepare(
      `INSERT INTO support_tickets (id, user_id, username, email, subject, category, priority, status, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ticket of s.supportTickets || []) {
      insTicket.run(
        ticket.id,
        ticket.userId,
        ticket.username,
        ticket.email,
        ticket.subject,
        ticket.category,
        ticket.priority,
        ticket.status,
        JSON.stringify(ticket.messages || []),
        ticket.createdAt,
        ticket.updatedAt
      );
    }

    const insVoice = db.prepare(
      `INSERT INTO voice_servers (id, name, host, turn_port, region_label, region_code, region_group, priority, capacity, enabled, status, latency_ms, turn_secret_set, last_checked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const node of s.voiceServers || []) {
      insVoice.run(
        node.id,
        node.name,
        node.host,
        node.turnPort,
        node.regionLabel,
        node.regionCode,
        node.regionGroup,
        node.priority,
        node.capacity,
        node.enabled ? 1 : 0,
        node.status,
        node.latencyMs,
        node.turnSecret ? 1 : 0,
        node.lastCheckedAt,
        node.updatedAt
      );
    }
  });

  runSync(state);
}

export function getSqliteEngineSummary(): DatabaseEngineSummary {
  if (!Database) {
    return {
      engine: 'SQLite unavailable (serverless platform)',
      sqliteVersion: 'n/a',
      journalMode: 'N/A',
      dbPath: 'n/a',
      sizeBytes: 0,
      pageSize: 0,
      pageCount: 0,
      firestoreDatabaseId: 'n/a',
      tables: [],
    };
  }
  const db = getDb();
  const verRow = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
  const jmRow = db.pragma('journal_mode', { simple: true }) as string;
  const pageSize = Number(db.pragma('page_size', { simple: true }) || 4096);
  const pageCount = Number(db.pragma('page_count', { simple: true }) || 0);
  const sizeBytes = fs.existsSync(SQLITE_FILE) ? fs.statSync(SQLITE_FILE).size : pageSize * pageCount;

  const tables: DatabaseTableMeta[] = ALLOWED_RELATIONAL_TABLES.map((name) => {
    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ${name}`).get() as { cnt: number };
    const infoRows = db.pragma(`table_info(${name})`) as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    return {
      name,
      rowCount: Number(countRow?.cnt || 0),
      columns: infoRows.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        pk: Boolean(c.pk),
      })),
    };
  });

  return {
    engine: 'Built-in SQLite (better-sqlite3 WAL)',
    sqliteVersion: verRow?.v || '3.x',
    journalMode: String(jmRow || 'wal').toUpperCase(),
    dbPath: 'data/snout.db',
    sizeBytes,
    pageSize,
    pageCount,
    firestoreDatabaseId: readFirestoreDbId(),
    tables,
  };
}

export function getSqliteTableRows(
  tableName: string,
  limit = 100,
  offset = 0
): { table: string; columns: string[]; rows: Array<Record<string, unknown>>; total: number } {
  if (!ALLOWED_RELATIONAL_TABLES.includes(tableName as AllowedTable)) {
    throw new Error(`Unknown or restricted table: ${tableName}`);
  }
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const db = getDb();

  const totalRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ${tableName}`).get() as { cnt: number };
  const infoRows = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  const rows = db
    .prepare(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`)
    .all(safeLimit, safeOffset) as Array<Record<string, unknown>>;

  return {
    table: tableName,
    columns: infoRows.map((c) => c.name),
    rows,
    total: Number(totalRow?.cnt || 0),
  };
}

export function executeReadOnlySql(rawSql: string): SqlQueryResult {
  const trimmed = rawSql.trim().replace(/;+\s*$/, '');
  if (!trimmed) {
    throw new Error('SQL query cannot be empty.');
  }
  if (trimmed.includes(';')) {
    throw new Error('Only single-statement read-only SQL queries are permitted.');
  }

  const upper = trimmed.toUpperCase();
  const startsAllowed =
    upper.startsWith('SELECT') ||
    upper.startsWith('WITH') ||
    upper.startsWith('EXPLAIN') ||
    upper.startsWith('PRAGMA');

  if (!startsAllowed) {
    throw new Error('Only SELECT, WITH, EXPLAIN, or read-only PRAGMA statements are allowed.');
  }

  // Block mutating keywords anywhere in the statement
  const forbiddenPattern =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE)\b/i;
  if (forbiddenPattern.test(trimmed)) {
    throw new Error('Write or schema-mutating SQL keywords are blocked in the read-only inspector.');
  }
  if (upper.startsWith('PRAGMA') && trimmed.includes('=')) {
    throw new Error('Mutating PRAGMA assignments are not permitted.');
  }

  const db = getDb();
  const t0 = performance.now();
  const stmt = db.prepare(trimmed);
  const allRows = stmt.all() as Array<Record<string, unknown>>;
  const durationMs = Number((performance.now() - t0).toFixed(2));
  const capped = allRows.slice(0, 250);
  let columns: string[] = [];
  if (capped.length > 0) {
    columns = Object.keys(capped[0]);
  } else {
    try {
      columns = stmt.columns().map((c: any) => c.name);
    } catch {
      columns = [];
    }
  }

  return {
    columns,
    rows: capped,
    rowCount: allRows.length,
    durationMs,
  };
}

export function runSqliteMaintenance(): {
  integrity: string;
  vacuumed: boolean;
  sizeBytes: number;
} {
  const db = getDb();
  const integrityRow = db.pragma('integrity_check', { simple: true }) as string;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  const sizeBytes = fs.existsSync(SQLITE_FILE) ? fs.statSync(SQLITE_FILE).size : 0;
  return {
    integrity: String(integrityRow || 'ok'),
    vacuumed: true,
    sizeBytes,
  };
}
