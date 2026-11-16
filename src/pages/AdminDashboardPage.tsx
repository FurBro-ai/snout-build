import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  KeyRound,
  Layers,
  LayoutGrid,
  Megaphone,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server as ServerIcon,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Table2,
  Trash2,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AuditLogEntry,
  BotApp,
  DatabaseEngineSummary,
  PaymentRecord,
  PublicUser,
  ScheduledEvent,
  Server,
  ServerDatabaseTable,
  SqlQueryResult,
  SubscriptionRecord,
} from '../../shared/types.ts';
import { SnoutBrandIcon } from '../components/SnoutBrandIcon.tsx';
import { BadgeRow } from '../components/BadgeChip.tsx';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { AdminBadgesPanel } from './admin/AdminBadgesPanel.tsx';
import { AdminCommunityDatabasesPanel } from './admin/AdminCommunityDatabasesPanel.tsx';
import { AdminIntegrationsPanel } from './admin/AdminIntegrationsPanel.tsx';
import { AdminSupportPanel } from './admin/AdminSupportPanel.tsx';
import { AdminVoiceServersPanel } from './admin/AdminVoiceServersPanel.tsx';
import { AdminVotesPanel } from './admin/AdminVotesPanel.tsx';

type AdminTab =
  | 'overview'
  | 'users'
  | 'badges'
  | 'sessions'
  | 'support'
  | 'servers'
  | 'communitydb'
  | 'assets'
  | 'votes'
  | 'database'
  | 'payments'
  | 'integrations'
  | 'voiceservers'
  | 'bots'
  | 'audit';

const PRESET_SQL_QUERIES = [
  {
    label: 'Users & Roles',
    sql: 'SELECT id, username, display_name, platform_role, is_nitro, email_verified, two_factor_enabled, created_at FROM users ORDER BY created_at DESC LIMIT 25',
  },
  {
    label: 'Recent Messages',
    sql: 'SELECT m.id, s.name AS server, c.name AS channel, u.username AS author, substr(m.content, 1, 90) AS preview, m.created_at FROM messages m LEFT JOIN servers s ON s.id = m.server_id LEFT JOIN channels c ON c.id = m.channel_id LEFT JOIN users u ON u.id = m.author_id ORDER BY m.created_at DESC LIMIT 25',
  },
  {
    label: 'Server DB Tables',
    sql: 'SELECT d.id, s.name AS server, d.name AS table_name, COUNT(r.id) AS row_count, d.updated_at FROM server_databases d LEFT JOIN servers s ON s.id = d.server_id LEFT JOIN server_database_rows r ON r.table_id = d.id GROUP BY d.id ORDER BY row_count DESC',
  },
  {
    label: 'Platega Revenue',
    sql: 'SELECT order_id, user_id, amount, currency, status, created_at, confirmed_at FROM payments ORDER BY created_at DESC LIMIT 25',
  },
];

interface AdminStats {
  totalUsers: number;
  verifiedUsersCount: number;
  twoFactorAdoptionCount: number;
  suspendedUsersCount: number;
  totalBots: number;
  totalServers: number;
  publicServersCount: number;
  totalChannels: number;
  totalMessages: number;
  totalServerDatabases: number;
  totalDatabaseRows: number;
  totalScheduledEvents: number;
  totalBookmarks: number;
  totalCommunityIdeas: number;
  totalSupportTickets: number;
  openSupportTickets: number;
  totalBadges: number;
  totalVoiceServers: number;
  onlineVoiceServers: number;
  voiceRelayCapacity: number;
  activeNitroCount: number;
  confirmedPaymentsCount: number;
  pendingPaymentsCount: number;
  totalRevenueUsd: number;
  activeSessionsCount: number;
  realtimeClientsCount: number;
  voiceParticipantsCount: number;
  processUptimeSeconds: number;
  memoryRssMb: number;
  plategaConfigured: boolean;
}

interface ActivityBucket {
  date: string;
  label: string;
  messages: number;
  signups: number;
  revenueUsd: number;
}

interface AdminUserRow extends PublicUser {
  email: string;
  isSuspended: boolean;
  activeSessionCount: number;
  serverCount: number;
  messageCount: number;
}

interface AdminServerRow extends Server {
  ownerUsername: string;
  memberCount: number;
  channelCount: number;
  messageCount: number;
  databaseCount: number;
  eventCount: number;
}

interface AdminSessionRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  platformRole: 'USER' | 'ADMIN';
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
}

interface AdminBotRow extends BotApp {
  ownerUsername: string;
  logCount: number;
}

interface AdminDatabaseAsset extends ServerDatabaseTable {
  serverName: string;
  creatorUsername: string;
  rowCount: number;
}

interface AdminEventAsset extends ScheduledEvent {
  serverName: string;
  creatorUsername: string;
  rsvpCount: number;
}

interface UserDetailResponse {
  user: PublicUser & { email: string; isSuspended: boolean };
  sessions: Array<{ id: string; userAgent: string; ipAddress: string; createdAt: string; expiresAt: string }>;
  loginHistory: Array<{ id: string; details: string; createdAt: string }>;
  servers: Array<{ id: string; name: string; isOwner: boolean; isPublic: boolean }>;
  payments: PaymentRecord[];
  subscription: SubscriptionRecord | null;
  bots: BotApp[];
  messageCount: number;
  bookmarkCount: number;
}

interface ServerDetailResponse {
  server: Server & { ownerUsername: string };
  channels: Array<{ id: string; name: string; type: string; isPrivate: boolean }>;
  roles: Array<{ id: string; name: string; color: string }>;
  databases: Array<ServerDatabaseTable & { rowCount: number }>;
  events: ScheduledEvent[];
  members: Array<{ userId: string; username: string; displayName: string; joinedAt: string }>;
}

const SECTION_LABELS: Record<AdminTab, string> = {
  overview: 'Command Overview',
  users: 'Users & RBAC',
  badges: 'Platform Badges',
  sessions: 'Active Sessions',
  support: 'Support Inbox',
  servers: 'Servers & Channels',
  communitydb: 'Community Databases',
  assets: 'Tables & Events',
  votes: 'Roadmap Votes',
  database: 'SQLite & Cloud DB',
  payments: 'Payments & Nitro',
  integrations: 'Integrations',
  voiceservers: 'Voice Servers',
  bots: 'Bots & Webhooks',
  audit: 'Audit Logs',
};

function formatUptime(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const escapeCell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const AdminDashboardPage: React.FC = () => {
  const { user: currentUser, pushToast } = useChordStore();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Overview & Config
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activitySeries, setActivitySeries] = useState<ActivityBucket[]>([]);
  const [chartMetric, setChartMetric] = useState<'messages' | 'signups' | 'revenueUsd'>('messages');
  const [config, setConfig] = useState<{
    maintenanceMode: boolean;
    registrationEnabled: boolean;
    nitroPriceUsd: number;
  }>({
    maintenanceMode: false,
    registrationEnabled: true,
    nitroPriceUsd: 2,
  });

  // Broadcast
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // Collections
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userFilter, setUserFilter] = useState<'all' | 'admins' | 'nitro' | '2fa' | 'suspended' | 'unverified'>('all');
  const [inspectedUserDetail, setInspectedUserDetail] = useState<UserDetailResponse | null>(null);
  const [editUserDisplayName, setEditUserDisplayName] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);

  const [servers, setServers] = useState<AdminServerRow[]>([]);
  const [serverFilter, setServerFilter] = useState<'all' | 'public' | 'private'>('all');
  const [confirmServerDelete, setConfirmServerDelete] = useState<string | null>(null);
  const [inspectedServerDetail, setInspectedServerDetail] = useState<ServerDetailResponse | null>(null);

  const [dbAssets, setDbAssets] = useState<AdminDatabaseAsset[]>([]);
  const [eventAssets, setEventAssets] = useState<AdminEventAsset[]>([]);

  const [payments, setPayments] = useState<Array<PaymentRecord & { username: string; email: string }>>([]);
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'CONFIRMED' | 'PENDING' | 'CHARGEBACKED' | 'FAILED'>('ALL');
  const [subscriptions, setSubscriptions] = useState<Array<SubscriptionRecord & { username: string }>>([]);

  const [bots, setBots] = useState<AdminBotRow[]>([]);
  const [confirmDeleteBotId, setConfirmDeleteBotId] = useState<string | null>(null);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'ADMIN' | 'NITRO' | 'USER' | 'DATABASE'>('ALL');

  // SQLite Inspector & Console
  const [dbSummary, setDbSummary] = useState<DatabaseEngineSummary | null>(null);
  const [selectedDbTable, setSelectedDbTable] = useState<string>('users');
  const [tableOffset, setTableOffset] = useState(0);
  const [tableRowFilter, setTableRowFilter] = useState('');
  const [inspectedSqlRow, setInspectedSqlRow] = useState<Record<string, unknown> | null>(null);
  const [tableData, setTableData] = useState<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    total: number;
  } | null>(null);
  const [sqlInput, setSqlInput] = useState(PRESET_SQL_QUERIES[0].sql);
  const [sqlResult, setSqlResult] = useState<SqlQueryResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [runningMaintenance, setRunningMaintenance] = useState(false);

  const loadDbTable = async (tableName: string, nextOffset = 0) => {
    setSelectedDbTable(tableName);
    setTableOffset(nextOffset);
    try {
      const res = await apiRequest<{
        columns: string[];
        rows: Array<Record<string, unknown>>;
        total: number;
      }>(`/api/admin/database/table/${encodeURIComponent(tableName)}?limit=25&offset=${nextOffset}`);
      setTableData(res);
    } catch (err) {
      pushToast({ type: 'error', title: 'Table load failed', description: (err as Error).message });
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ov, us, ss, sv, wa, py, bt, lg, dbRes] = await Promise.all([
        apiRequest<{ stats: AdminStats; activitySeries: ActivityBucket[]; platformConfig: typeof config }>(
          '/api/admin/overview'
        ),
        apiRequest<{ users: AdminUserRow[] }>('/api/admin/users'),
        apiRequest<{ sessions: AdminSessionRow[] }>('/api/admin/sessions'),
        apiRequest<{ servers: AdminServerRow[] }>('/api/admin/servers'),
        apiRequest<{ databases: AdminDatabaseAsset[]; events: AdminEventAsset[] }>('/api/admin/workspace-assets'),
        apiRequest<{ payments: typeof payments; subscriptions: typeof subscriptions }>('/api/admin/payments'),
        apiRequest<{ bots: AdminBotRow[] }>('/api/admin/bots'),
        apiRequest<{ logs: AuditLogEntry[] }>('/api/admin/audit-logs'),
        apiRequest<{ summary: DatabaseEngineSummary }>('/api/admin/database/summary'),
      ]);
      setStats(ov.stats);
      setActivitySeries(ov.activitySeries || []);
      setConfig(ov.platformConfig);
      setUsers(us.users);
      setSessions(ss.sessions);
      setServers(sv.servers);
      setDbAssets(wa.databases);
      setEventAssets(wa.events);
      setPayments(py.payments);
      setSubscriptions(py.subscriptions);
      setBots(bt.bots);
      setLogs(lg.logs);
      setDbSummary(dbRes.summary);
      await loadDbTable(selectedDbTable || 'users', tableOffset);
    } catch (err) {
      pushToast({ type: 'error', title: 'Failed to load admin data', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // User Actions
  const inspectUser = async (userId: string) => {
    try {
      const res = await apiRequest<UserDetailResponse>(`/api/admin/users/${userId}/detail`);
      setInspectedUserDetail(res);
      setEditUserDisplayName(res.user.displayName);
      setConfirmDeleteUserId(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Failed to load user details', description: (err as Error).message });
    }
  };

  const toggleUserFlag = async (userId: string, patch: Record<string, unknown>) => {
    try {
      await apiRequest(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadAll();
      if (inspectedUserDetail?.user.id === userId) {
        await inspectUser(userId);
      }
      pushToast({ type: 'success', title: 'User account updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    }
  };

  const handleRevokeUserSessions = async (userId: string) => {
    try {
      const res = await apiRequest<{ revokedCount: number }>(`/api/admin/users/${userId}/revoke-sessions`, {
        method: 'POST',
      });
      await loadAll();
      if (inspectedUserDetail?.user.id === userId) {
        await inspectUser(userId);
      }
      pushToast({ type: 'info', title: `Revoked ${res.revokedCount} active session(s)` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Session revocation failed', description: (err as Error).message });
    }
  };

  const handleDisableUser2fa = async (userId: string) => {
    try {
      await apiRequest(`/api/admin/users/${userId}/disable-2fa`, { method: 'POST' });
      await loadAll();
      if (inspectedUserDetail?.user.id === userId) {
        await inspectUser(userId);
      }
      pushToast({ type: 'info', title: 'Emergency 2FA reset completed' });
    } catch (err) {
      pushToast({ type: 'error', title: '2FA reset failed', description: (err as Error).message });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' });
      setInspectedUserDetail(null);
      setConfirmDeleteUserId(null);
      await loadAll();
      pushToast({ type: 'info', title: 'User account permanently deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'User deletion failed', description: (err as Error).message });
    }
  };

  const handleRevokeSingleSession = async (sessionId: string) => {
    try {
      await apiRequest(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
      await loadAll();
      pushToast({ type: 'info', title: 'Session terminated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Revoke failed', description: (err as Error).message });
    }
  };

  // Server Actions
  const inspectServer = async (serverId: string) => {
    try {
      const res = await apiRequest<ServerDetailResponse>(`/api/admin/servers/${serverId}/detail`);
      setInspectedServerDetail(res);
    } catch (err) {
      pushToast({ type: 'error', title: 'Failed to load server details', description: (err as Error).message });
    }
  };

  const handleUpdateServer = async (serverId: string, patch: Record<string, unknown>) => {
    try {
      await apiRequest(`/api/admin/servers/${serverId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadAll();
      if (inspectedServerDetail?.server.id === serverId) {
        await inspectServer(serverId);
      }
      pushToast({ type: 'success', title: 'Server governance settings updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Server update failed', description: (err as Error).message });
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await apiRequest(`/api/admin/servers/${serverId}`, { method: 'DELETE' });
      setConfirmServerDelete(null);
      setInspectedServerDetail(null);
      await loadAll();
      pushToast({ type: 'info', title: 'Server removed from platform' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  // Workspace Assets Actions
  const handleDeleteDbAsset = async (tableId: string) => {
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${tableId}`, { method: 'DELETE' });
      await loadAll();
      pushToast({ type: 'info', title: 'Server database deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  const handleDeleteEventAsset = async (eventId: string) => {
    try {
      await apiRequest(`/api/admin/workspace-assets/events/${eventId}`, { method: 'DELETE' });
      await loadAll();
      pushToast({ type: 'info', title: 'Scheduled event deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  // Payments & Bots Actions
  const handleConfirmPayment = async (paymentId: string) => {
    try {
      await apiRequest(`/api/admin/payments/${paymentId}/confirm`, { method: 'POST' });
      await loadAll();
      pushToast({ type: 'success', title: 'Payment manually confirmed & Nitro activated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Confirm failed', description: (err as Error).message });
    }
  };

  const handleRefund = async (paymentId: string) => {
    try {
      await apiRequest(`/api/admin/payments/${paymentId}/refund`, { method: 'POST' });
      await loadAll();
      pushToast({ type: 'info', title: 'Payment marked refunded & Nitro revoked' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Refund failed', description: (err as Error).message });
    }
  };

  const handleDeleteBot = async (botId: string) => {
    try {
      await apiRequest(`/api/admin/bots/${botId}`, { method: 'DELETE' });
      setConfirmDeleteBotId(null);
      await loadAll();
      pushToast({ type: 'info', title: 'Bot application deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Bot delete failed', description: (err as Error).message });
    }
  };

  // Config & Broadcast
  const toggleConfig = async (key: 'maintenanceMode' | 'registrationEnabled') => {
    try {
      await apiRequest('/api/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: !config[key] }),
      });
      await loadAll();
      pushToast({ type: 'success', title: 'Platform configuration saved' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Config update failed', description: (err as Error).message });
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return;
    setSendingBroadcast(true);
    try {
      const res = await apiRequest<{ recipientCount: number }>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ title: broadcastTitle.trim(), body: broadcastBody.trim() }),
      });
      setBroadcastTitle('');
      setBroadcastBody('');
      await loadAll();
      pushToast({
        type: 'success',
        title: 'Broadcast dispatched',
        description: `Delivered real-time alert to ${res.recipientCount} user(s).`,
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Broadcast failed', description: (err as Error).message });
    } finally {
      setSendingBroadcast(false);
    }
  };

  // SQLite Actions
  const handleRunSql = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSqlError(null);
    try {
      const res = await apiRequest<{ result: SqlQueryResult }>('/api/admin/database/query', {
        method: 'POST',
        body: JSON.stringify({ sql: sqlInput }),
      });
      setSqlResult(res.result);
    } catch (err) {
      setSqlError((err as Error).message);
      setSqlResult(null);
    }
  };

  const handleDbMaintenance = async () => {
    setRunningMaintenance(true);
    try {
      const res = await apiRequest<{
        report: { integrity: string; vacuumed: boolean; sizeBytes: number };
        summary: DatabaseEngineSummary;
      }>('/api/admin/database/maintenance', { method: 'POST' });
      setDbSummary(res.summary);
      pushToast({
        type: 'success',
        title: 'SQLite WAL Checkpoint & VACUUM Complete',
        description: `Integrity: ${res.report.integrity} · ${(res.report.sizeBytes / 1024).toFixed(1)} KB`,
      });
      await loadAll();
    } catch (err) {
      pushToast({ type: 'error', title: 'Maintenance failed', description: (err as Error).message });
    } finally {
      setRunningMaintenance(false);
    }
  };

  const handleExportDbJson = async () => {
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/admin/database/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snout-db-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast({ type: 'success', title: 'Database snapshot exported' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Export failed', description: (err as Error).message });
    }
  };

  // Filtering
  const q = search.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (userFilter === 'admins' && u.platformRole !== 'ADMIN') return false;
      if (userFilter === 'nitro' && !u.isNitro) return false;
      if (userFilter === '2fa' && !u.twoFactorEnabled) return false;
      if (userFilter === 'suspended' && !u.isSuspended) return false;
      if (userFilter === 'unverified' && u.emailVerified) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, userFilter, q]);

  const filteredSessions = useMemo(() => {
    return sessions.filter(
      (s) =>
        !q ||
        s.username.toLowerCase().includes(q) ||
        s.ipAddress.toLowerCase().includes(q) ||
        s.userAgent.toLowerCase().includes(q)
    );
  }, [sessions, q]);

  const filteredServers = useMemo(() => {
    return servers.filter((s) => {
      if (serverFilter === 'public' && !s.isPublic) return false;
      if (serverFilter === 'private' && s.isPublic) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.ownerUsername.toLowerCase().includes(q);
    });
  }, [servers, serverFilter, q]);

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (paymentFilter !== 'ALL' && p.status !== paymentFilter) return false;
      if (!q) return true;
      return (
        p.orderId.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q)
      );
    });
  }, [payments, paymentFilter, q]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (auditFilter === 'ADMIN' && !l.action.startsWith('ADMIN_')) return false;
      if (auditFilter === 'NITRO' && !l.action.includes('NITRO') && !l.action.includes('PLATEGA')) return false;
      if (auditFilter === 'USER' && l.targetType !== 'USER') return false;
      if (auditFilter === 'DATABASE' && !l.targetType.includes('DATABASE')) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        (l.actorName || '').toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [logs, auditFilter, q]);

  const filteredTableRows = useMemo(() => {
    if (!tableData) return [];
    const rf = tableRowFilter.trim().toLowerCase();
    if (!rf) return tableData.rows;
    return tableData.rows.filter((row) =>
      Object.values(row).some((val) => String(val ?? '').toLowerCase().includes(rf))
    );
  }, [tableData, tableRowFilter]);

  const maxChartVal = Math.max(1, ...activitySeries.map((b) => Number(b[chartMetric] || 0)));

  const navGroups: Array<{
    label: string;
    items: Array<{
      id: AdminTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      count?: number;
    }>;
  }> = [
    {
      label: 'Operations',
      items: [
        { id: 'overview', label: 'Command Overview', icon: LayoutGrid },
        { id: 'users', label: 'Users & RBAC', icon: Users, count: users.length },
        { id: 'badges', label: 'Platform Badges', icon: Crown, count: stats?.totalBadges },
        { id: 'sessions', label: 'Active Sessions', icon: KeyRound, count: sessions.length },
        { id: 'support', label: 'Support Inbox', icon: ShieldCheck, count: stats?.openSupportTickets },
      ],
    },
    {
      label: 'Community',
      items: [
        { id: 'servers', label: 'Servers', icon: ServerIcon, count: servers.length },
        { id: 'communitydb', label: 'Community Databases', icon: Database, count: dbAssets.length },
        { id: 'assets', label: 'Tables & Events', icon: Layers, count: dbAssets.length + eventAssets.length },
        { id: 'votes', label: 'Roadmap Votes', icon: Megaphone, count: stats?.totalCommunityIdeas },
      ],
    },
    {
      label: 'Platform',
      items: [
        { id: 'database', label: 'SQLite & Cloud DB', icon: Table2, count: dbSummary?.tables.length },
        { id: 'payments', label: 'Payments & Nitro', icon: Wallet, count: payments.length },
        { id: 'integrations', label: 'Integrations', icon: Wrench },
        { id: 'voiceservers', label: 'Voice Servers', icon: Radio, count: stats?.totalVoiceServers },
        { id: 'bots', label: 'Bots & Webhooks', icon: Bot, count: bots.length },
        { id: 'audit', label: 'Audit Logs', icon: ShieldAlert, count: logs.length },
      ],
    },
  ];

  const navItems = navGroups.flatMap((group) => group.items);

  return (
    <div className="flex flex-1 min-w-0 h-full bg-[#0D0F12] text-[#F1F3F5] overflow-hidden">
      {/* Left Admin Sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between border-r border-white/[0.06] bg-[#101318] p-4">
        <div className="space-y-5 overflow-y-auto no-scrollbar">
          <div className="flex items-center gap-3 px-2 py-1">
            <SnoutBrandIcon className="h-9 w-9 rounded-lg ring-1 ring-white/15 shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-sm font-bold text-white truncate">Snout Console</div>
              <div className="text-[11px] text-slate-400 truncate">Platform Governance</div>
            </div>
          </div>

          <nav className="space-y-4" aria-label="Admin sections">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setTab(item.id);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#5865F2] text-white'
                          : 'text-slate-400 hover:bg-[#171A21] hover:text-slate-100'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.count !== undefined && (
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            active ? 'text-white/90' : 'text-slate-500'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div className="border-t border-white/[0.06] pt-3 px-2 space-y-1.5 text-[11px] text-slate-400 font-mono tabular-nums">
          <div className="flex items-center justify-between">
            <span>Engine</span>
            <span className="text-slate-200">{dbSummary?.journalMode || 'WAL'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Sockets</span>
            <span className="text-emerald-400">{stats?.realtimeClientsCount ?? 0}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Uptime</span>
            <span className="text-slate-200">{stats ? formatUptime(stats.processUptimeSeconds) : '—'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top Breadcrumb Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] bg-[#0D0F12] px-6 py-3.5 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
            <SnoutBrandIcon className="h-6 w-6 rounded-md lg:hidden shrink-0" />
            <span>Snout</span>
            <span aria-hidden="true">/</span>
            <span>Administration</span>
            <span aria-hidden="true">/</span>
            <h1 className="font-display text-sm font-semibold text-white truncate">{SECTION_LABELS[tab]}</h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {(tab === 'users' ||
              tab === 'sessions' ||
              tab === 'servers' ||
              tab === 'payments' ||
              tab === 'audit') && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${SECTION_LABELS[tab].toLowerCase()}...`}
                  className="w-48 sm:w-56 rounded-lg border border-white/10 bg-[#12151A] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleExportDbJson()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1E222B] whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Snapshot</span>
            </button>

            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4] whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* Mobile Compact Nav */}
        <div className="flex lg:hidden gap-1.5 overflow-x-auto border-b border-white/[0.06] bg-[#101318] px-4 py-2 shrink-0">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setSearch('');
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                tab === item.id ? 'bg-[#5865F2] text-white' : 'bg-[#171A21] text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Viewport Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: COMMAND OVERVIEW */}
          {tab === 'overview' && stats && (
            <div className="space-y-6">
              {/* 6-Card Operational KPI Grid */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Accounts & Security</span>
                    <Users className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                    {stats.totalUsers}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.verifiedUsersCount} verified · {stats.twoFactorAdoptionCount} 2FA · {stats.suspendedUsersCount} suspended
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Servers & Channels</span>
                    <ServerIcon className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                    {stats.totalServers}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.publicServersCount} public · {stats.totalChannels} channels · {stats.totalBots} bots
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Messages & Bookmarks</span>
                    <Activity className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                    {stats.totalMessages}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.totalBookmarks} saved bookmarks
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Verified Platega Revenue</span>
                    <Crown className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                    ${stats.totalRevenueUsd.toFixed(2)}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.activeNitroCount} active Nitro · {stats.confirmedPaymentsCount} confirmed · {stats.pendingPaymentsCount} pending
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Built-in Server Databases</span>
                    <Table2 className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                    {stats.totalServerDatabases} tables
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.totalDatabaseRows} structured rows · {stats.totalScheduledEvents} events
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Runtime & Connections</span>
                    <Database className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-indigo-300 tabular-nums">
                    {stats.realtimeClientsCount} live
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.activeSessionsCount} sessions · {stats.voiceParticipantsCount} voice · {stats.memoryRssMb} MB RSS
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Voice Relay Fleet</span>
                    <Radio className="h-4 w-4 text-[#818CF8]" />
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                    {stats.onlineVoiceServers}/{stats.totalVoiceServers} online
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    {stats.voiceRelayCapacity.toLocaleString()} slots · auto latency routing
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('voiceservers')}
                    className="mt-2 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200"
                  >
                    Manage voice servers →
                  </button>
                </div>
              </div>

              {/* Quick actions + community pulse */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { tab: 'support' as AdminTab, title: 'Support inbox', value: `${stats.openSupportTickets} open`, hint: 'Reply to members', icon: ShieldCheck, tone: 'text-amber-300' },
                  { tab: 'votes' as AdminTab, title: 'Roadmap votes', value: `${stats.totalCommunityIdeas} ideas`, hint: 'Triage community requests', icon: Megaphone, tone: 'text-indigo-300' },
                  { tab: 'badges' as AdminTab, title: 'Platform badges', value: `${stats.totalBadges} badges`, hint: 'Award member recognition', icon: Crown, tone: 'text-amber-200' },
                  { tab: 'integrations' as AdminTab, title: 'Platega billing', value: stats.plategaConfigured ? 'Connected' : 'Needs setup', hint: 'Merchant settings & webhook', icon: Wallet, tone: stats.plategaConfigured ? 'text-emerald-300' : 'text-rose-300' },
                ].map((action) => (
                  <button
                    key={action.tab}
                    type="button"
                    onClick={() => setTab(action.tab)}
                    className="group rounded-xl border border-white/[0.07] bg-[#12151A] p-4 text-left transition-colors hover:border-[#5865F2]/50 hover:bg-[#151923]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{action.title}</span>
                      <action.icon className={`h-4 w-4 ${action.tone}`} />
                    </div>
                    <div className="mt-1.5 font-mono text-lg font-bold text-white tabular-nums">{action.value}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500 group-hover:text-slate-400">{action.hint} →</div>
                  </button>
                ))}
              </div>

              {/* 7-Day Activity Chart + Governance Controls */}
              <div className="grid gap-6 lg:grid-cols-12 items-stretch">
                <div className="lg:col-span-7 rounded-xl border border-white/[0.07] bg-[#12151A] p-5 flex flex-col justify-between space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-sm font-semibold text-white">7-Day Platform Activity</h2>
                      <p className="text-xs text-slate-400">Real UTC daily totals computed from SQLite state.</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg bg-[#0D0F12] p-1 border border-white/[0.06]">
                      {([
                        ['messages', 'Messages'],
                        ['signups', 'Signups'],
                        ['revenueUsd', 'Revenue ($)'],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setChartMetric(key)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            chartMetric === key
                              ? 'bg-[#5865F2] text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-3 items-end h-44 pt-4 border-t border-white/[0.05]">
                    {activitySeries.map((day) => {
                      const val = Number(day[chartMetric] || 0);
                      const pct = Math.max(4, Math.round((val / maxChartVal) * 100));
                      return (
                        <div key={day.date} className="flex flex-col items-center gap-2 h-full justify-end group">
                          <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                            {chartMetric === 'revenueUsd' ? `$${val.toFixed(0)}` : val}
                          </span>
                          <div className="w-full max-w-[38px] flex-1 flex items-end">
                            <div
                              title={`${day.label}: ${chartMetric === 'revenueUsd' ? `$${val.toFixed(2)}` : val}`}
                              style={{ height: `${pct}%` }}
                              className={`w-full rounded-t-md transition-colors ${
                                chartMetric === 'revenueUsd'
                                  ? 'bg-emerald-500/80 group-hover:bg-emerald-400'
                                  : chartMetric === 'signups'
                                  ? 'bg-indigo-400/80 group-hover:bg-indigo-300'
                                  : 'bg-[#5865F2] group-hover:bg-[#7280FF]'
                              }`}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-slate-500 whitespace-nowrap">{day.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live Platform Config & Broadcast */}
                <div className="lg:col-span-5 rounded-xl border border-white/[0.07] bg-[#12151A] p-5 flex flex-col justify-between space-y-5">
                  <div className="space-y-3">
                    <h2 className="font-display text-sm font-semibold text-white">Governance & Billing Config</h2>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => void toggleConfig('registrationEnabled')}
                        className={`rounded-lg border px-3 py-2 font-medium whitespace-nowrap ${
                          config.registrationEnabled
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        Registration: {config.registrationEnabled ? 'Open' : 'Paused'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleConfig('maintenanceMode')}
                        className={`rounded-lg border px-3 py-2 font-medium whitespace-nowrap ${
                          config.maintenanceMode
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-white/10 bg-[#171A21] text-slate-300'
                        }`}
                      >
                        Maintenance: {config.maintenanceMode ? 'Active' : 'Normal'}
                      </button>
                    </div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      Platega: {stats.plategaConfigured ? 'Merchant Keys Active' : 'Env Credentials Needed'} · Plan: ${config.nitroPriceUsd.toFixed(2)} USD/mo
                    </div>
                  </div>

                  <form onSubmit={handleSendBroadcast} className="space-y-2.5 border-t border-white/[0.06] pt-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <Megaphone className="h-3.5 w-3.5 text-[#818CF8]" />
                      <span>Global Platform Broadcast</span>
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={96}
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      placeholder="Announcement title"
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                    />
                    <textarea
                      rows={2}
                      required
                      maxLength={500}
                      value={broadcastBody}
                      onChange={(e) => setBroadcastBody(e.target.value)}
                      placeholder="Message delivered in real time to all active users..."
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={sendingBroadcast}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50 whitespace-nowrap"
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                      <span>{sendingBroadcast ? 'Sending...' : 'Send Broadcast'}</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USERS & RBAC */}
          {tab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#12151A] p-1 border border-white/[0.07]">
                  {([
                    ['all', 'All'],
                    ['admins', 'Admins'],
                    ['nitro', 'Nitro'],
                    ['2fa', '2FA Active'],
                    ['suspended', 'Suspended'],
                    ['unverified', 'Unverified'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setUserFilter(key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        userFilter === key ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `snout-users-${new Date().toISOString().slice(0, 10)}.csv`,
                      ['ID', 'Username', 'Display Name', 'Email', 'Role', 'Nitro', '2FA', 'Verified', 'Suspended'],
                      filteredUsers.map((u) => [
                        u.id,
                        u.username,
                        u.displayName,
                        u.email,
                        u.platformRole,
                        u.isNitro,
                        u.twoFactorEnabled,
                        u.emailVerified,
                        u.isSuspended,
                      ])
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B] whitespace-nowrap"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Account</th>
                      <th className="px-4 py-3">Email & Verification</th>
                      <th className="px-4 py-3">Role & 2FA</th>
                      <th className="px-4 py-3 text-right">Activity</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No user accounts match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelf = currentUser?.id === u.id;
                        return (
                          <tr key={u.id} className="hover:bg-white/[0.02]">
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-white">@{u.username}</div>
                              <div className="text-[11px] text-slate-400">{u.displayName}</div>
                              {u.badges && u.badges.length > 0 && (
                                <div className="mt-1">
                                  <BadgeRow badges={u.badges} max={3} />
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">
                              <div>{u.email}</div>
                              <div className="text-[11px] text-slate-400">
                                {u.emailVerified ? (
                                  <span className="text-emerald-400">Verified</span>
                                ) : (
                                  <span className="text-amber-300">Unverified</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px]">
                              <span className={u.platformRole === 'ADMIN' ? 'text-rose-300 font-semibold' : 'text-slate-300'}>
                                {u.platformRole}
                              </span>
                              <span className="mx-1.5 text-slate-600">·</span>
                              <span className={u.twoFactorEnabled ? 'text-emerald-400' : 'text-slate-500'}>
                                {u.twoFactorEnabled ? '2FA On' : 'No 2FA'}
                              </span>
                              {u.isNitro && (
                                <>
                                  <span className="mx-1.5 text-slate-600">·</span>
                                  <span className="text-amber-300">Nitro</span>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-[11px] text-slate-300 tabular-nums">
                              {u.serverCount} srv · {u.messageCount} msg · {u.activeSessionCount} sess
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px]">
                              {u.isSuspended ? (
                                <span className="text-rose-400">Suspended</span>
                              ) : (
                                <span className="text-emerald-400">Active</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void inspectUser(u.id)}
                                  className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-2.5 py-1 text-slate-200 hover:bg-white/15 whitespace-nowrap"
                                >
                                  <Eye className="h-3 w-3" />
                                  Inspect
                                </button>
                                <button
                                  type="button"
                                  disabled={isSelf && u.platformRole === 'ADMIN'}
                                  onClick={() =>
                                    void toggleUserFlag(u.id, {
                                      platformRole: u.platformRole === 'ADMIN' ? 'USER' : 'ADMIN',
                                    })
                                  }
                                  className="rounded bg-indigo-500/15 px-2.5 py-1 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-40 whitespace-nowrap"
                                >
                                  {u.platformRole === 'ADMIN' ? (isSelf ? 'Admin (You)' : 'Revoke Admin') : 'Make Admin'}
                                </button>
                                {!u.emailVerified && (
                                  <button
                                    type="button"
                                    onClick={() => void toggleUserFlag(u.id, { emailVerified: true })}
                                    className="rounded bg-emerald-500/15 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/25 whitespace-nowrap"
                                  >
                                    Verify
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void toggleUserFlag(u.id, { isNitro: !u.isNitro })}
                                  className="rounded bg-amber-500/15 px-2.5 py-1 text-amber-300 hover:bg-amber-500/25 whitespace-nowrap"
                                >
                                  {u.isNitro ? 'Revoke Nitro' : 'Grant Nitro'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSelf}
                                  onClick={() => void toggleUserFlag(u.id, { isSuspended: !u.isSuspended })}
                                  className="rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 whitespace-nowrap"
                                >
                                  {u.isSuspended ? 'Unban account' : 'Ban account'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PLATFORM BADGES */}
          {tab === 'badges' && <AdminBadgesPanel />}

          {/* SUPPORT INBOX */}
          {tab === 'support' && <AdminSupportPanel />}

          {/* COMMUNITY DATABASES (moved from server view) */}
          {tab === 'communitydb' && <AdminCommunityDatabasesPanel />}

          {/* ROADMAP VOTES */}
          {tab === 'votes' && <AdminVotesPanel />}

          {/* PLATEGA & INTEGRATIONS */}
          {tab === 'integrations' && <AdminIntegrationsPanel />}

          {tab === 'voiceservers' && <AdminVoiceServersPanel />}

          {/* TAB 3: ACTIVE SESSIONS */}
          {tab === 'sessions' && (
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Active Authenticated Sessions ({filteredSessions.length})</span>
                <span className="text-slate-400">Revoking immediately logs out the remote client via WebSocket.</span>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Client Agent</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No active sessions found.
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5 font-medium text-white">
                          @{s.username}{' '}
                          <span className="font-mono text-[10px] text-slate-400">({s.platformRole})</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{s.ipAddress}</td>
                        <td className="px-4 py-2.5 max-w-[260px] truncate text-slate-400">{s.userAgent}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400 tabular-nums">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400 tabular-nums">
                          {new Date(s.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void handleRevokeSingleSession(s.id)}
                            className="rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: SERVERS & GOVERNANCE */}
          {tab === 'servers' && (
            <div className="space-y-4">
              <div className="flex items-center gap-1 w-fit rounded-lg bg-[#12151A] p-1 border border-white/[0.07]">
                {([
                  ['all', 'All Servers'],
                  ['public', 'Public Discovery'],
                  ['private', 'Invite Only'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setServerFilter(key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      serverFilter === key ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Server</th>
                      <th className="px-4 py-3">Owner</th>
                      <th className="px-4 py-3">Visibility</th>
                      <th className="px-4 py-3">Boost Tier</th>
                      <th className="px-4 py-3 text-right">Resources</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredServers.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white">{s.name}</div>
                          <div className="text-[11px] text-slate-400 max-w-xs truncate">{s.description || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">@{s.ownerUsername}</td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => void handleUpdateServer(s.id, { isPublic: !s.isPublic })}
                            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                              s.isPublic
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-white/[0.06] text-slate-300'
                            }`}
                          >
                            {s.isPublic ? 'Public' : 'Invite Only'}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            aria-label={`Boost tier for ${s.name}`}
                            value={s.boostTier}
                            onChange={(e) => void handleUpdateServer(s.id, { boostTier: Number(e.target.value) })}
                            className="rounded border border-white/10 bg-[#0D0F12] px-2 py-1 font-mono text-[11px] text-amber-300 focus:outline-none"
                          >
                            <option value={0}>Tier 0</option>
                            <option value={1}>Tier 1</option>
                            <option value={2}>Tier 2</option>
                            <option value={3}>Tier 3</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[11px] text-slate-300 tabular-nums">
                          {s.memberCount} mem · {s.channelCount} ch · {s.databaseCount} db · {s.eventCount} evt
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void inspectServer(s.id)}
                              className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-2.5 py-1 text-slate-200 hover:bg-white/15 whitespace-nowrap"
                            >
                              <Eye className="h-3 w-3" />
                              Inspect
                            </button>
                            {confirmServerDelete === s.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteServer(s.id)}
                                  className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500 whitespace-nowrap"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmServerDelete(null)}
                                  className="rounded bg-white/10 px-2 py-1 text-slate-300 whitespace-nowrap"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmServerDelete(s.id)}
                                className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: WORKSPACE TABLES & SCHEDULED EVENTS */}
          {tab === 'assets' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2 text-xs font-semibold text-white">
                  <Table2 className="h-4 w-4 text-[#818CF8]" />
                  <span>Collaborative Server Databases ({dbAssets.length})</span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Table Name</th>
                      <th className="px-4 py-3">Server</th>
                      <th className="px-4 py-3">Creator</th>
                      <th className="px-4 py-3 text-right">Columns</th>
                      <th className="px-4 py-3 text-right">Rows</th>
                      <th className="px-4 py-3 text-right">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {dbAssets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                          No server database tables created yet.
                        </td>
                      </tr>
                    ) : (
                      dbAssets.map((d) => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-white">{d.name}</div>
                            <div className="text-[11px] text-slate-400">{d.description || '—'}</div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-300">{d.serverName}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">@{d.creatorUsername}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{d.columns.length}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{d.rowCount}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void handleDeleteDbAsset(d.id)}
                              className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete Table
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2 text-xs font-semibold text-white">
                  <CalendarClock className="h-4 w-4 text-emerald-400" />
                  <span>Scheduled Server Events ({eventAssets.length})</span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Event Title</th>
                      <th className="px-4 py-3">Server</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Starts At</th>
                      <th className="px-4 py-3 text-right">RSVPs</th>
                      <th className="px-4 py-3 text-right">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {eventAssets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                          No scheduled events across the platform.
                        </td>
                      </tr>
                    ) : (
                      eventAssets.map((ev) => (
                        <tr key={ev.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 font-medium text-white">{ev.title}</td>
                          <td className="px-4 py-2.5 text-slate-300">{ev.serverName}</td>
                          <td className="px-4 py-2.5 text-slate-400">{ev.locationLabel}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-300 tabular-nums">
                            {new Date(ev.startsAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{ev.rsvpCount}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void handleDeleteEventAsset(ev.id)}
                              className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                            >
                              <Trash2 className="h-3 w-3" />
                              Remove Event
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: BUILT-IN SQLITE & CLOUD DB */}
          {tab === 'database' && dbSummary && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                  <div className="text-xs text-slate-400">Built-in SQLite Engine</div>
                  <div className="mt-1.5 font-mono text-sm font-bold text-white">
                    v{dbSummary.sqliteVersion} · {dbSummary.journalMode}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                  <div className="text-xs text-slate-400">Database Storage</div>
                  <div className="mt-1.5 font-mono text-sm font-bold text-emerald-400 tabular-nums">
                    {(dbSummary.sizeBytes / 1024).toFixed(1)} KB · {dbSummary.pageCount} pages
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                  <div className="text-xs text-slate-400">Relational Schema</div>
                  <div className="mt-1.5 font-mono text-sm font-bold text-white tabular-nums">
                    {dbSummary.tables.length} Normalized Tables
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
                  <div className="text-xs text-slate-400">Firestore Database ID</div>
                  <div className="mt-1.5 font-mono text-[11px] font-semibold text-indigo-300 truncate">
                    {dbSummary.firestoreDatabaseId}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={runningMaintenance}
                  onClick={() => void handleDbMaintenance()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50 whitespace-nowrap"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>{runningMaintenance ? 'Running VACUUM...' : 'Run Integrity Check & VACUUM'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportDbJson()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#1E222B] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export Full JSON</span>
                </button>
              </div>

              {/* Table Explorer with Pagination + Filter + Row Inspector */}
              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-sm font-semibold text-white">SQLite Table Browser</h2>
                    <div className="font-mono text-[11px] text-slate-400">{dbSummary.dbPath}</div>
                  </div>
                  <input
                    type="text"
                    value={tableRowFilter}
                    onChange={(e) => setTableRowFilter(e.target.value)}
                    placeholder="Filter loaded rows..."
                    className="w-52 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {dbSummary.tables.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => void loadDbTable(t.name, 0)}
                      className={`rounded-lg px-2.5 py-1.5 font-mono text-xs transition-colors whitespace-nowrap ${
                        selectedDbTable === t.name
                          ? 'bg-[#5865F2] text-white'
                          : 'bg-[#171A21] text-slate-300 hover:bg-[#262B36]'
                      }`}
                    >
                      {t.name} <span className="opacity-75">({t.rowCount})</span>
                    </button>
                  ))}
                </div>

                {tableData && (
                  <>
                    <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] overflow-x-auto max-h-80">
                      <table className="w-full text-left font-mono text-[11px]">
                        <thead className="border-b border-white/[0.06] bg-[#14171D] text-slate-400 sticky top-0">
                          <tr>
                            {tableData.columns.map((col) => (
                              <th key={col} className="px-3 py-2 whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {filteredTableRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={Math.max(1, tableData.columns.length)}
                                className="px-3 py-6 text-center text-slate-500"
                              >
                                No rows to display in `{selectedDbTable}`.
                              </td>
                            </tr>
                          ) : (
                            filteredTableRows.map((row, idx) => (
                              <tr
                                key={idx}
                                onClick={() => setInspectedSqlRow(row)}
                                title="Click to inspect full row JSON"
                                className="cursor-pointer hover:bg-white/[0.04]"
                              >
                                {tableData.columns.map((col) => (
                                  <td key={col} className="px-3 py-1.5 max-w-[220px] truncate text-slate-300">
                                    {row[col] === null || row[col] === undefined ? 'NULL' : String(row[col])}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
                      <span>
                        Showing {tableData.rows.length > 0 ? tableOffset + 1 : 0}–{tableOffset + tableData.rows.length} of{' '}
                        {tableData.total} row(s) · Click any row to inspect JSON
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={tableOffset === 0}
                          onClick={() => void loadDbTable(selectedDbTable, Math.max(0, tableOffset - 25))}
                          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#171A21] px-2.5 py-1 text-slate-200 disabled:opacity-40"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          Prev
                        </button>
                        <button
                          type="button"
                          disabled={tableOffset + 25 >= tableData.total}
                          onClick={() => void loadDbTable(selectedDbTable, tableOffset + 25)}
                          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#171A21] px-2.5 py-1 text-slate-200 disabled:opacity-40"
                        >
                          Next
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Read-Only SQL Console */}
              <form
                onSubmit={handleRunSql}
                className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-sm font-semibold text-white">Read-Only SQL Query Console</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_SQL_QUERIES.map((pq) => (
                      <button
                        key={pq.label}
                        type="button"
                        onClick={() => setSqlInput(pq.sql)}
                        className="rounded border border-white/10 bg-[#171A21] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white whitespace-nowrap"
                      >
                        {pq.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={3}
                  value={sqlInput}
                  onChange={(e) => setSqlInput(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0D0F12] p-3 font-mono text-xs text-emerald-300 focus:border-[#5865F2] focus:outline-none"
                  placeholder="SELECT * FROM users LIMIT 20"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Execute SQL</span>
                    </button>
                    {sqlResult && sqlResult.rows.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            `snout-sql-${new Date().toISOString().slice(0, 10)}.csv`,
                            sqlResult.columns,
                            sqlResult.rows.map((r) => sqlResult.columns.map((c) => r[c]))
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171A21] px-3 py-2 text-xs text-slate-200 hover:bg-[#262B36] whitespace-nowrap"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span>Download CSV</span>
                      </button>
                    )}
                  </div>
                  {sqlResult && (
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {sqlResult.rowCount} row(s) returned in {sqlResult.durationMs}ms
                    </span>
                  )}
                </div>

                {sqlError && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-200">
                    {sqlError}
                  </div>
                )}

                {sqlResult && sqlResult.columns.length > 0 && (
                  <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] overflow-x-auto max-h-72">
                    <table className="w-full text-left font-mono text-[11px]">
                      <thead className="border-b border-white/[0.06] bg-[#14171D] text-slate-400">
                        <tr>
                          {sqlResult.columns.map((c) => (
                            <th key={c} className="px-3 py-2 whitespace-nowrap">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {sqlResult.rows.map((r, i) => (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            {sqlResult.columns.map((c) => (
                              <td key={c} className="px-3 py-1.5 max-w-[240px] truncate text-slate-200">
                                {r[c] === null || r[c] === undefined ? 'NULL' : String(r[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB 7: PAYMENTS & NITRO */}
          {tab === 'payments' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#12151A] p-1 border border-white/[0.07]">
                  {(['ALL', 'CONFIRMED', 'PENDING', 'CHARGEBACKED', 'FAILED'] as const).map((statusKey) => (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => setPaymentFilter(statusKey)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        paymentFilter === statusKey
                          ? 'bg-[#5865F2] text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {statusKey}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `snout-payments-${new Date().toISOString().slice(0, 10)}.csv`,
                      ['Order ID', 'User', 'Amount', 'Currency', 'Status', 'Created At'],
                      filteredPayments.map((p) => [p.orderId, p.username, p.amount, p.currency, p.status, p.createdAt])
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B] whitespace-nowrap"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export Ledger</span>
                </button>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <div className="px-4 py-3 border-b border-white/[0.06] text-xs font-semibold text-white">
                  Platega Payment Records ({filteredPayments.length})
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Order ID</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-right">Reconciliation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                          No matching payment records.
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 font-mono text-slate-200">{p.orderId}</td>
                          <td className="px-4 py-2.5">@{p.username}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            ${Number(p.amount).toFixed(2)} {p.currency}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px]">
                            <span
                              className={
                                p.status === 'CONFIRMED'
                                  ? 'text-emerald-400'
                                  : p.status === 'PENDING'
                                  ? 'text-amber-300'
                                  : 'text-rose-400'
                              }
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400 tabular-nums">
                            {new Date(p.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {p.status === 'PENDING' && (
                                <button
                                  type="button"
                                  onClick={() => void handleConfirmPayment(p.id)}
                                  className="rounded bg-emerald-500/15 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/25 whitespace-nowrap"
                                >
                                  Manual Confirm
                                </button>
                              )}
                              {p.status === 'CONFIRMED' && (
                                <button
                                  type="button"
                                  onClick={() => void handleRefund(p.id)}
                                  className="rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                                >
                                  Mark Refunded
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
                <div className="px-4 py-3 border-b border-white/[0.06] text-xs font-semibold text-white">
                  SNOUT NITRO Subscriptions ({subscriptions.length})
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Period End</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {subscriptions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          No Nitro subscriptions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      subscriptions.map((s) => (
                        <tr key={s.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5">@{s.username}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums">$2.00 / month</td>
                          <td className="px-4 py-2.5 font-mono text-[11px]">
                            <span className={s.status === 'ACTIVE' ? 'text-emerald-400' : 'text-slate-400'}>
                              {s.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-slate-300">
                            {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: BOTS & WEBHOOKS */}
          {tab === 'bots' && (
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Bot Name</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Webhook URL</th>
                    <th className="px-4 py-3 text-right">Installed</th>
                    <th className="px-4 py-3 text-right">Commands / Logs</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {bots.map((b) => (
                    <tr key={b.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-white">{b.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">{b.tokenPrefix}...</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">@{b.ownerUsername}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400 max-w-[220px] truncate">
                        {b.webhookUrl || 'Gateway-only'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {b.installedServerIds.length}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">
                        {b.slashCommands.length} cmd · {b.logCount} logs
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {b.id === 'bot-app-chord-sentinel' ? (
                          <span className="font-mono text-[11px] text-slate-500">System Bot</span>
                        ) : confirmDeleteBotId === b.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleDeleteBot(b.id)}
                              className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteBotId(null)}
                              className="rounded bg-white/10 px-2 py-1 text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteBotId(b.id)}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2.5 py-1 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 9: AUDIT LOGS */}
          {tab === 'audit' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#12151A] p-1 border border-white/[0.07]">
                  {(['ALL', 'ADMIN', 'NITRO', 'USER', 'DATABASE'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setAuditFilter(cat)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        auditFilter === cat ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `snout-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                      ['Timestamp', 'Action', 'Actor', 'Target Type', 'Target ID', 'Details'],
                      filteredLogs.map((l) => [
                        l.createdAt,
                        l.action,
                        l.actorName || l.actorId,
                        l.targetType,
                        l.targetId,
                        l.details,
                      ])
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B] whitespace-nowrap"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto max-h-[580px]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5">Timestamp</th>
                      <th className="px-4 py-2.5">Action</th>
                      <th className="px-4 py-2.5">Actor</th>
                      <th className="px-4 py-2.5">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          No matching audit events found.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((l) => (
                        <tr key={l.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2 whitespace-nowrap text-slate-500 tabular-nums">
                            {new Date(l.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-indigo-300">{l.action}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-white">{l.actorName || l.actorId}</td>
                          <td className="px-4 py-2 text-slate-300">{l.details}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* USER INSPECT MODAL */}
      {inspectedUserDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  Inspect Account: @{inspectedUserDetail.user.username}
                </h2>
                <p className="text-xs text-slate-400 font-mono">
                  {inspectedUserDetail.user.email} · ID {inspectedUserDetail.user.id}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close user inspector"
                onClick={() => setInspectedUserDetail(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Servers</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedUserDetail.servers.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Active Sessions</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedUserDetail.sessions.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Messages</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedUserDetail.messageCount}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Bookmarks</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedUserDetail.bookmarkCount}
                </div>
              </div>
            </div>

            {/* Edit Display Name */}
            <div className="flex flex-wrap items-end gap-3 border-t border-white/[0.06] pt-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-slate-400 mb-1">Display Name Override</label>
                <input
                  type="text"
                  value={editUserDisplayName}
                  onChange={(e) => setEditUserDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  void toggleUserFlag(inspectedUserDetail.user.id, { displayName: editUserDisplayName })
                }
                className="rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] whitespace-nowrap"
              >
                Save Display Name
              </button>
            </div>

            {/* Platform badges */}
            <div className="space-y-2 border-t border-white/[0.06] pt-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Platform Badges</span>
                <button type="button" onClick={() => setTab('badges')} className="text-indigo-300 hover:underline">
                  Manage badges
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                @{inspectedUserDetail.user.username} currently holds {inspectedUserDetail.user.badgeIds?.length || 0} badge(s).
              </p>
            </div>

            {/* Emergency Security Controls */}
            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4 text-xs">
              <button
                type="button"
                onClick={() => void handleRevokeUserSessions(inspectedUserDetail.user.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-amber-300 hover:bg-amber-500/25 whitespace-nowrap"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Revoke All Sessions ({inspectedUserDetail.sessions.length})
              </button>

              {inspectedUserDetail.user.twoFactorEnabled && (
                <button
                  type="button"
                  onClick={() => void handleDisableUser2fa(inspectedUserDetail.user.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-3 py-1.5 text-indigo-300 hover:bg-indigo-500/25 whitespace-nowrap"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  Emergency Reset 2FA
                </button>
              )}

              {currentUser?.id !== inspectedUserDetail.user.id && (
                confirmDeleteUserId === inspectedUserDetail.user.id ? (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleDeleteUser(inspectedUserDetail.user.id)}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500"
                    >
                      Confirm Permanent Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteUserId(null)}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteUserId(inspectedUserDetail.user.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-rose-300 hover:bg-rose-500/25 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Account
                  </button>
                )
              )}
            </div>

            <section className="space-y-2 border-t border-white/[0.06] pt-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Recent Sign-ins</span>
                <span className="font-mono text-[10px] text-slate-500">Last {inspectedUserDetail.loginHistory.length}</span>
              </div>
              {inspectedUserDetail.loginHistory.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 p-3 text-slate-500">No sign-in history recorded yet.</p>
              ) : (
                <div className="max-h-48 divide-y divide-white/[0.05] overflow-y-auto rounded-lg border border-white/[0.06] bg-[#0D0F12]">
                  {inspectedUserDetail.loginHistory.map((entry) => (
                    <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="font-mono text-slate-200">{entry.details.replace(/^Successful sign-in from IP /, '')}</span>
                      <time className="text-[10px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {inspectedUserDetail.servers.length > 0 && (
              <div className="space-y-2 border-t border-white/[0.06] pt-4 text-xs">
                <div className="font-semibold text-white">Server Memberships</div>
                <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#0D0F12]">
                  {inspectedUserDetail.servers.map((srv) => (
                    <div key={srv.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-slate-200">{srv.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {srv.isOwner ? 'Owner' : 'Member'} · {srv.isPublic ? 'Public' : 'Private'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SERVER INSPECT MODAL */}
      {inspectedServerDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#12151A] p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white">{inspectedServerDetail.server.name}</h2>
                <p className="text-xs text-slate-400 font-mono">
                  Owner @{inspectedServerDetail.server.ownerUsername} · Tier {inspectedServerDetail.server.boostTier} ·{' '}
                  {inspectedServerDetail.server.isPublic ? 'Public' : 'Invite Only'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close server inspector"
                onClick={() => setInspectedServerDetail(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Members</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedServerDetail.members.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Channels</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedServerDetail.channels.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Databases</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedServerDetail.databases.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0D0F12] p-3">
                <div className="text-slate-400">Events</div>
                <div className="mt-1 font-mono text-base font-bold text-white tabular-nums">
                  {inspectedServerDetail.events.length}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-semibold text-white">Channels</div>
              <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#0D0F12] max-h-40 overflow-y-auto">
                {inspectedServerDetail.channels.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-slate-200">#{c.name}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {c.type} {c.isPrivate ? '· Private' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-semibold text-white">Members ({inspectedServerDetail.members.length})</div>
              <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#0D0F12] max-h-40 overflow-y-auto">
                {inspectedServerDetail.members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-slate-200">
                      @{m.username} <span className="text-slate-400">({m.displayName})</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Joined {new Date(m.joinedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SQLITE ROW JSON INSPECTOR MODAL */}
      {inspectedSqlRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#12151A] p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h2 className="font-display text-sm font-semibold text-white">
                Row Record Inspector · {selectedDbTable}
              </h2>
              <button
                type="button"
                aria-label="Close row inspector"
                onClick={() => setInspectedSqlRow(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg border border-white/[0.06] bg-[#0D0F12] p-4 font-mono text-xs text-emerald-300">
              {JSON.stringify(inspectedSqlRow, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
