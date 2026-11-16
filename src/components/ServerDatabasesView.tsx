import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  Columns,
  Database,
  Download,
  ExternalLink,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import type {
  DatabaseColumnType,
  ServerDatabaseColumn,
  ServerDatabaseRow,
  ServerDatabaseTable,
} from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

const TABLE_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  columns: Array<{ name: string; type: DatabaseColumnType; options?: string[] }>;
}> = [
  {
    id: 'tasks',
    label: 'Task Tracker',
    description: 'Track sprints, owners, statuses, and priorities.',
    columns: [
      { name: 'Task', type: 'text' },
      { name: 'Status', type: 'status', options: ['Backlog', 'In Progress', 'Review', 'Done'] },
      { name: 'Points', type: 'number' },
      { name: 'Urgent', type: 'checkbox' },
      { name: 'Due Date', type: 'date' },
    ],
  },
  {
    id: 'bugs',
    label: 'Issue & Bug Log',
    description: 'Triage bug reports and reproduction links.',
    columns: [
      { name: 'Summary', type: 'text' },
      { name: 'Severity', type: 'status', options: ['Low', 'Medium', 'High', 'Critical'] },
      { name: 'Fixed', type: 'checkbox' },
      { name: 'Reference URL', type: 'url' },
    ],
  },
  {
    id: 'directory',
    label: 'Resource Directory',
    description: 'Organize links, docs, bots, and guides.',
    columns: [
      { name: 'Resource', type: 'text' },
      { name: 'Category', type: 'status', options: ['Docs', 'Tools', 'Media', 'Community'] },
      { name: 'Link', type: 'url' },
      { name: 'Verified', type: 'checkbox' },
    ],
  },
];

function getStatusStyle(val: string): string {
  const lower = val.toLowerCase();
  if (['done', 'shipped', 'fixed', 'verified', 'low', 'live'].some((k) => lower.includes(k))) {
    return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300';
  }
  if (['in progress', 'review', 'medium', 'planned'].some((k) => lower.includes(k))) {
    return 'border-indigo-500/35 bg-indigo-500/15 text-indigo-300';
  }
  if (['high', 'critical', 'blocked', 'urgent'].some((k) => lower.includes(k))) {
    return 'border-rose-500/35 bg-rose-500/15 text-rose-300';
  }
  return 'border-white/15 bg-white/5 text-slate-300';
}

export const ServerDatabasesView: React.FC = () => {
  const {
    serverBundle,
    serverDatabases,
    serverDatabaseRows,
    refreshServerDatabases,
    pushToast,
  } = useChordStore();

  const serverId = serverBundle?.server.id || '';
  const canManageTables = serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_CHANNELS) ||
      hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_SERVER)
    : false;

  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const [showCreateTable, setShowCreateTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableDesc, setNewTableDesc] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('tasks');
  const [creatingTable, setCreatingTable] = useState(false);

  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<DatabaseColumnType>('text');

  const [showNewRow, setShowNewRow] = useState(false);
  const [newRowCells, setNewRowCells] = useState<Record<string, string | number | boolean>>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string; value: string } | null>(null);

  const activeTable: ServerDatabaseTable | null = useMemo(() => {
    if (serverDatabases.length === 0) return null;
    return (
      serverDatabases.find((t) => t.id === selectedTableId) || serverDatabases[0]
    );
  }, [serverDatabases, selectedTableId]);

  const tableRows = useMemo(() => {
    if (!activeTable) return [];
    const q = search.trim().toLowerCase();
    const list = serverDatabaseRows.filter((r) => {
      if (r.tableId !== activeTable.id) return false;
      if (!q) return true;
      return Object.values(r.cells).some((v) => String(v).toLowerCase().includes(q));
    });
    if (sortColId) {
      list.sort((a, b) => {
        const av = a.cells[sortColId] ?? '';
        const bv = b.cells[sortColId] ?? '';
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sortAsc ? cmp : -cmp;
      });
    }
    return list;
  }, [activeTable, serverDatabaseRows, search, sortColId, sortAsc]);

  if (!serverBundle) return null;

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableName.trim()) return;
    const tpl = TABLE_TEMPLATES.find((t) => t.id === selectedTemplateId) || TABLE_TEMPLATES[0];
    setCreatingTable(true);
    try {
      const res = await apiRequest<{ table: ServerDatabaseTable }>(
        `/api/servers/${serverId}/databases`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newTableName.trim(),
            description: newTableDesc.trim() || tpl.description,
            columns: tpl.columns,
          }),
        }
      );
      await refreshServerDatabases(serverId);
      setSelectedTableId(res.table.id);
      setShowCreateTable(false);
      setNewTableName('');
      setNewTableDesc('');
      pushToast({ type: 'success', title: 'Database table created' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Create table failed', description: (err as Error).message });
    } finally {
      setCreatingTable(false);
    }
  };

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTable || !newColName.trim()) return;
    try {
      await apiRequest(`/api/servers/${serverId}/databases/${activeTable.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          addColumn: {
            name: newColName.trim(),
            type: newColType,
          },
        }),
      });
      setNewColName('');
      setShowAddColumn(false);
      await refreshServerDatabases(serverId);
      pushToast({ type: 'success', title: 'Column added' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Failed to add column', description: (err as Error).message });
    }
  };

  const handleDeleteTable = async () => {
    if (!activeTable) return;
    try {
      await apiRequest(`/api/servers/${serverId}/databases/${activeTable.id}`, {
        method: 'DELETE',
      });
      setSelectedTableId('');
      await refreshServerDatabases(serverId);
      pushToast({ type: 'info', title: `Deleted ${activeTable.name}` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  const handleAddRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTable) return;
    try {
      await apiRequest(`/api/servers/${serverId}/databases/${activeTable.id}/rows`, {
        method: 'POST',
        body: JSON.stringify({ cells: newRowCells }),
      });
      setNewRowCells({});
      setShowNewRow(false);
      await refreshServerDatabases(serverId);
      pushToast({ type: 'success', title: 'Record added to built-in database' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Add row failed', description: (err as Error).message });
    }
  };

  const updateCell = async (row: ServerDatabaseRow, col: ServerDatabaseColumn, nextVal: string | number | boolean) => {
    if (!activeTable) return;
    try {
      await apiRequest(`/api/servers/${serverId}/databases/${activeTable.id}/rows/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cells: { [col.id]: nextVal } }),
      });
      await refreshServerDatabases(serverId);
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    }
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!activeTable) return;
    try {
      await apiRequest(`/api/servers/${serverId}/databases/${activeTable.id}/rows/${rowId}`, {
        method: 'DELETE',
      });
      await refreshServerDatabases(serverId);
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete row failed', description: (err as Error).message });
    }
  };

  const exportCsv = () => {
    if (!activeTable) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = activeTable.columns.map((c) => esc(c.name)).join(',');
    const lines = tableRows.map((r) =>
      activeTable.columns.map((c) => esc(r.cells[c.id] ?? '')).join(',')
    );
    const blob = new Blob([[headers, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTable.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-1 flex-col bg-[#171A21] overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#12151A] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865F2]/20 text-[#818CF8]">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-white">
              {serverBundle.server.name} · Built-in Databases
            </h1>
            <p className="text-xs text-slate-400">
              Collaborative structured SQLite tables synced live across all server members.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTable && (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171A21] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          )}
          {canManageTables && (
            <button
              type="button"
              onClick={() => setShowCreateTable((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Table</span>
            </button>
          )}
        </div>
      </header>

      {/* Table Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#14171D] px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {serverDatabases.map((tbl) => {
            const count = serverDatabaseRows.filter((r) => r.tableId === tbl.id).length;
            const active = activeTable?.id === tbl.id;
            return (
              <button
                key={tbl.id}
                type="button"
                onClick={() => {
                  setSelectedTableId(tbl.id);
                  setSortColId(null);
                  setShowNewRow(false);
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[#5865F2] text-white'
                    : 'bg-[#171A21] text-slate-300 hover:bg-[#262B36]'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span>{tbl.name}</span>
                <span className="font-mono text-[10px] opacity-80 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>

        {activeTable && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter rows..."
                className="w-44 rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setNewRowCells({});
                setShowNewRow((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Row</span>
            </button>
            {canManageTables && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAddColumn((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-[#1E222B]"
                >
                  <Columns className="h-3.5 w-3.5" />
                  <span>+ Column</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteTable()}
                  title="Delete Table"
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Create Table Panel */}
        {showCreateTable && (
          <form
            onSubmit={handleCreateTable}
            className="rounded-xl border border-[#5865F2]/40 bg-[#12151A] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">Create Built-in Database Table</h2>
              <button type="button" onClick={() => setShowCreateTable(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="Table name (e.g. Sprint Backlog)"
                className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <input
                type="text"
                value={newTableDesc}
                onChange={(e) => setNewTableDesc(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {TABLE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`rounded-lg border p-3 text-left text-xs transition-colors ${
                    selectedTemplateId === tpl.id
                      ? 'border-[#5865F2] bg-[#5865F2]/15 text-white'
                      : 'border-white/10 bg-[#171A21] text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="font-semibold">{tpl.label}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{tpl.description}</div>
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={creatingTable}
              className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
            >
              {creatingTable ? 'Creating...' : 'Create Database Table'}
            </button>
          </form>
        )}

        {/* Add Column Panel */}
        {showAddColumn && activeTable && (
          <form
            onSubmit={handleAddColumn}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#12151A] p-4 text-xs"
          >
            <input
              type="text"
              required
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="New column name..."
              className="w-48 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-white focus:border-[#5865F2] focus:outline-none"
            />
            <select
              value={newColType}
              onChange={(e) => setNewColType(e.target.value as DatabaseColumnType)}
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-white"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="status">Status</option>
              <option value="checkbox">Checkbox</option>
              <option value="date">Date</option>
              <option value="url">URL</option>
            </select>
            <button type="submit" className="rounded-lg bg-[#5865F2] px-3 py-1.5 font-semibold text-white">
              Add Column
            </button>
            <button type="button" onClick={() => setShowAddColumn(false)} className="text-slate-400 px-2">
              Cancel
            </button>
          </form>
        )}

        {/* Add Row Form */}
        {showNewRow && activeTable && (
          <form
            onSubmit={handleAddRow}
            className="rounded-xl border border-emerald-500/35 bg-[#12151A] p-4 space-y-3"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span>New Record in {activeTable.name}</span>
              <button type="button" onClick={() => setShowNewRow(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeTable.columns.map((col) => (
                <div key={col.id} className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-400">{col.name}</label>
                  {col.type === 'checkbox' ? (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-200 pt-1">
                      <input
                        type="checkbox"
                        checked={Boolean(newRowCells[col.id])}
                        onChange={(e) =>
                          setNewRowCells((prev) => ({ ...prev, [col.id]: e.target.checked }))
                        }
                        className="rounded border-white/20 bg-[#0D0F12]"
                      />
                      <span>Checked</span>
                    </label>
                  ) : col.type === 'status' ? (
                    <select
                      value={String(newRowCells[col.id] ?? col.options?.[0] ?? 'Todo')}
                      onChange={(e) =>
                        setNewRowCells((prev) => ({ ...prev, [col.id]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white"
                    >
                      {(col.options || ['Todo', 'In Progress', 'Done']).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                      value={String(newRowCells[col.id] ?? '')}
                      onChange={(e) =>
                        setNewRowCells((prev) => ({
                          ...prev,
                          [col.id]: col.type === 'number' ? Number(e.target.value) : e.target.value,
                        }))
                      }
                      placeholder={col.type === 'url' ? 'https://...' : col.name}
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Insert Record
            </button>
          </form>
        )}

        {/* Active Table Grid */}
        {!activeTable ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center space-y-2">
            <Database className="mx-auto h-8 w-8 text-slate-500" />
            <div className="font-display text-base font-semibold text-white">No database tables yet</div>
            <p className="text-xs text-slate-400">
              Create a structured table to track tasks, resources, bugs, or directories directly inside this server.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTable.description && (
              <p className="text-xs text-slate-400">{activeTable.description}</p>
            )}
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                  <tr>
                    {activeTable.columns.map((col) => (
                      <th key={col.id} className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            if (sortColId === col.id) setSortAsc((s) => !s);
                            else {
                              setSortColId(col.id);
                              setSortAsc(true);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 hover:text-white"
                        >
                          <span>{col.name}</span>
                          <ArrowDownUp className="h-3 w-3 opacity-60" />
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={activeTable.columns.length + 1} className="px-4 py-8 text-center text-slate-500">
                        No rows match this view. Click "Add Row" to insert a record.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.02]">
                        {activeTable.columns.map((col) => {
                          const val = row.cells[col.id];
                          const isEditing =
                            editingCell?.rowId === row.id && editingCell?.colId === col.id;

                          if (col.type === 'checkbox') {
                            const checked = Boolean(val);
                            return (
                              <td key={col.id} className="px-4 py-2.5">
                                <button
                                  type="button"
                                  onClick={() => void updateCell(row, col, !checked)}
                                  className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                                    checked
                                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                                      : 'border-white/20 bg-[#0D0F12] text-transparent'
                                  }`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            );
                          }

                          if (col.type === 'status') {
                            const opts = col.options && col.options.length > 0 ? col.options : ['Todo', 'In Progress', 'Done'];
                            const cur = String(val || opts[0]);
                            const nextOpt = opts[(opts.indexOf(cur) + 1) % opts.length];
                            return (
                              <td key={col.id} className="px-4 py-2.5">
                                <button
                                  type="button"
                                  title="Click to cycle status"
                                  onClick={() => void updateCell(row, col, nextOpt)}
                                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition-colors ${getStatusStyle(
                                    cur
                                  )}`}
                                >
                                  {cur}
                                </button>
                              </td>
                            );
                          }

                          if (isEditing) {
                            return (
                              <td key={col.id} className="px-3 py-2">
                                <input
                                  type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                                  autoFocus
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    setEditingCell({ ...editingCell, value: e.target.value })
                                  }
                                  onBlur={() => {
                                    const parsed =
                                      col.type === 'number'
                                        ? Number(editingCell.value || 0)
                                        : editingCell.value;
                                    setEditingCell(null);
                                    void updateCell(row, col, parsed);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const parsed =
                                        col.type === 'number'
                                          ? Number(editingCell.value || 0)
                                          : editingCell.value;
                                      setEditingCell(null);
                                      void updateCell(row, col, parsed);
                                    } else if (e.key === 'Escape') {
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="w-full rounded border border-[#5865F2] bg-[#0D0F12] px-2 py-1 text-xs text-white focus:outline-none"
                                />
                              </td>
                            );
                          }

                          const displayStr = val !== undefined && val !== '' ? String(val) : '—';
                          return (
                            <td
                              key={col.id}
                              onClick={() =>
                                setEditingCell({
                                  rowId: row.id,
                                  colId: col.id,
                                  value: String(val ?? ''),
                                })
                              }
                              className="px-4 py-2.5 cursor-pointer text-slate-200 hover:text-white"
                            >
                              {col.type === 'url' && typeof val === 'string' && val.startsWith('http') ? (
                                <a
                                  href={val}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
                                >
                                  <span className="truncate max-w-[180px]">{val}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ) : (
                                <span className={col.type === 'number' || col.type === 'date' ? 'font-mono tabular-nums' : ''}>
                                  {displayStr}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteRow(row.id)}
                            title="Delete Row"
                            className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
      </div>
    </div>
  );
};
