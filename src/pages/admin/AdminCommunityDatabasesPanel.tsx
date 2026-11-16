import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  Columns3,
  Copy,
  Database,
  Download,
  FileUp,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DatabaseColumnType,
  ServerDatabaseColumn,
  ServerDatabaseRow,
  ServerDatabaseTable,
} from '../../../shared/types.ts';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';

interface AdminTableAsset extends ServerDatabaseTable {
  serverName: string;
  creatorUsername: string;
  rowCount: number;
}

interface DraftColumn {
  name: string;
  type: DatabaseColumnType;
  options?: string;
}

const COLUMN_TYPES: Array<{ value: DatabaseColumnType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'status', label: 'Status' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
];

const DEFAULT_DRAFT_COLUMNS: DraftColumn[] = [
  { name: 'Name', type: 'text' },
  { name: 'Status', type: 'status', options: 'Planned, In Progress, Shipped' },
  { name: 'Notes', type: 'text' },
];

function statusStyle(value: string): string {
  const lower = value.toLowerCase();
  if (['done', 'shipped', 'fixed', 'verified', 'live'].some((k) => lower.includes(k))) {
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

export const AdminCommunityDatabasesPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [tables, setTables] = useState<AdminTableAsset[]>([]);
  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [rows, setRows] = useState<ServerDatabaseRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [search, setSearch] = useState('');
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [editing, setEditing] = useState<{ rowId: string; colId: string; value: string } | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newCells, setNewCells] = useState<Record<string, string | number | boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    serverId: '',
    name: '',
    description: '',
    columns: DEFAULT_DRAFT_COLUMNS,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadTables = async () => {
    setLoading(true);
    try {
      const [res, serverRes] = await Promise.all([
        apiRequest<{ databases: AdminTableAsset[] }>('/api/admin/workspace-assets'),
        apiRequest<{ servers: Array<{ id: string; name: string }> }>('/api/admin/servers'),
      ]);
      setTables(res.databases);
      setServers(serverRes.servers);
      setSelectedTableId((current) => current || res.databases[0]?.id || '');
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load databases', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const loadRows = async (tableId: string) => {
    if (!tableId) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    try {
      const res = await apiRequest<{ rows: ServerDatabaseRow[] }>(
        `/api/admin/workspace-assets/databases/${tableId}/rows`
      );
      setRows(res.rows);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load rows', description: (err as Error).message });
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    void loadTables();
  }, []);

  useEffect(() => {
    if (selectedTableId) void loadRows(selectedTableId);
  }, [selectedTableId]);

  const table = tables.find((t) => t.id === selectedTableId) || null;

  useEffect(() => {
    if (table) {
      setSettingsForm({ name: table.name, description: table.description });
    }
  }, [table?.id]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((row) => !q || Object.values(row.cells).some((v) => String(v ?? '').toLowerCase().includes(q)));
    if (sortColId) {
      list = [...list].sort((a, b) => {
        const av = a.cells[sortColId] ?? '';
        const bv = b.cells[sortColId] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortAsc ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, search, sortColId, sortAsc]);

  const updateCell = async (row: ServerDatabaseRow, col: ServerDatabaseColumn, value: string | number | boolean) => {
    if (!table) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.id]: value } } : r)));
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}/rows/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cells: { [col.id]: value } }),
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Cell update failed', description: (err as Error).message });
      await loadRows(table.id);
    }
  };

  const handleAddRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!table) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}/rows`, {
        method: 'POST',
        body: JSON.stringify({ cells: newCells }),
      });
      setNewCells({});
      setShowAddRow(false);
      await loadRows(table.id);
      await loadTables();
      pushToast({ type: 'success', title: 'Row added' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Add row failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!table) return;
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}/rows/${rowId}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      await loadTables();
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete row failed', description: (err as Error).message });
    }
  };

  const handleDeleteTable = async () => {
    if (!table) return;
    if (!window.confirm(`Delete the "${table.name}" database and all of its rows? This cannot be undone.`)) return;
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}`, { method: 'DELETE' });
      setSelectedTableId('');
      await loadTables();
      pushToast({ type: 'info', title: 'Database deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete database failed', description: (err as Error).message });
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const columns = createForm.columns
        .filter((col) => col.name.trim())
        .map((col) => ({
          name: col.name.trim(),
          type: col.type,
          ...(col.type === 'status'
            ? {
                options: (col.options || 'Planned, In Progress, Shipped')
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              }
            : {}),
        }));
      const res = await apiRequest<{ table: ServerDatabaseTable }>('/api/admin/workspace-assets/databases', {
        method: 'POST',
        body: JSON.stringify({
          serverId: createForm.serverId,
          name: createForm.name,
          description: createForm.description,
          columns,
        }),
      });
      setCreateForm({ serverId: '', name: '', description: '', columns: DEFAULT_DRAFT_COLUMNS });
      setShowCreate(false);
      await loadTables();
      setSelectedTableId(res.table.id);
      pushToast({ type: 'success', title: 'Database created', description: `${res.table.name} is live for its server.` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Create database failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!table) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: settingsForm.name, description: settingsForm.description }),
      });
      await loadTables();
      pushToast({ type: 'success', title: 'Database details saved' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Save failed', description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const addColumn = async (name: string, type: DatabaseColumnType) => {
    if (!table) return;
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ addColumn: { name, type } }),
      });
      await loadTables();
      pushToast({ type: 'success', title: 'Column added' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Add column failed', description: (err as Error).message });
    }
  };

  const deleteColumn = async (column: ServerDatabaseColumn) => {
    if (!table) return;
    if (!window.confirm(`Delete column "${column.name}" from ${table.name}? Existing values in this column are removed.`)) return;
    try {
      await apiRequest(`/api/admin/workspace-assets/databases/${table.id}/columns/${column.id}`, { method: 'DELETE' });
      await loadTables();
      await loadRows(table.id);
      pushToast({ type: 'info', title: `Column "${column.name}" deleted` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete column failed', description: (err as Error).message });
    }
  };

  const duplicateTable = async () => {
    if (!table) return;
    try {
      const res = await apiRequest<{ table: ServerDatabaseTable }>(
        `/api/admin/workspace-assets/databases/${table.id}/duplicate`,
        { method: 'POST' }
      );
      await loadTables();
      setSelectedTableId(res.table.id);
      pushToast({ type: 'success', title: 'Database duplicated', description: `${res.table.name} created with all rows copied.` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Duplicate failed', description: (err as Error).message });
    }
  };

  const importCsv = async (file: File) => {
    if (!table) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) throw new Error('CSV needs a header row and at least one data row.');
      const headers = parsed[0].map((h) => h.trim());
      const rowsToImport = parsed.slice(1).map((values) => {
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          record[header] = values[index] ?? '';
        });
        return record;
      });
      const res = await apiRequest<{ imported: number }>(
        `/api/admin/workspace-assets/databases/${table.id}/import`,
        { method: 'POST', body: JSON.stringify({ rows: rowsToImport }) }
      );
      await loadRows(table.id);
      await loadTables();
      pushToast({ type: 'success', title: `${res.imported} row(s) imported`, description: `Matched CSV headers to ${table.name} columns by name.` });
    } catch (err) {
      pushToast({ type: 'error', title: 'CSV import failed', description: (err as Error).message });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const exportCsv = () => {
    if (!table) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      table.columns.map((c) => esc(c.name)).join(','),
      ...filteredRows.map((row) => table.columns.map((c) => esc(row.cells[c.id] ?? '')).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${table.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading community databases…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tables.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => setSelectedTableId(asset.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium ${
                selectedTableId === asset.id ? 'bg-[#5865F2] text-white' : 'bg-[#12151A] text-slate-300 hover:bg-[#1E222B]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              {asset.name}
              <span className="font-mono text-[10px] opacity-75">{asset.rowCount}</span>
            </button>
          ))}
          {tables.length === 0 && <span className="text-xs text-slate-500">No community databases yet.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void loadTables()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B]">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateForm({
                serverId: servers[0]?.id || '',
                name: '',
                description: '',
                columns: DEFAULT_DRAFT_COLUMNS,
              });
              setShowCreate(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
          >
            <Plus className="h-3.5 w-3.5" /> New database
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateTable} className="space-y-3 rounded-xl border border-[#5865F2]/40 bg-[#12151A] p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-white">Create a database</h2>
            <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              required
              value={createForm.serverId}
              onChange={(e) => setCreateForm((p) => ({ ...p, serverId: e.target.value }))}
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
            >
              <option value="">Select server…</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input
              required
              value={createForm.name}
              onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Database name"
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <input
              value={createForm.description}
              onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Description (optional)"
              className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Schema · {createForm.columns.length}/16 columns
              </span>
              <button
                type="button"
                onClick={() =>
                  setCreateForm((p) => ({ ...p, columns: [...p.columns, { name: '', type: 'text' }] }))
                }
                disabled={createForm.columns.length >= 16}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Add column
              </button>
            </div>
            {createForm.columns.map((col, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1.5fr_auto]">
                <input
                  value={col.name}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      columns: p.columns.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)),
                    }))
                  }
                  placeholder={`Column ${index + 1}`}
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
                <select
                  value={col.type}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      columns: p.columns.map((c, i) => (i === index ? { ...c, type: e.target.value as DatabaseColumnType } : c)),
                    }))
                  }
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-xs text-white"
                >
                  {COLUMN_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <input
                  value={col.options || ''}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      columns: p.columns.map((c, i) => (i === index ? { ...c, options: e.target.value } : c)),
                    }))
                  }
                  disabled={col.type !== 'status'}
                  placeholder={col.type === 'status' ? 'Options, comma separated' : '—'}
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-[#5865F2] focus:outline-none disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() =>
                    setCreateForm((p) => ({
                      ...p,
                      columns: p.columns.length > 1 ? p.columns.filter((_, i) => i !== index) : p.columns,
                    }))
                  }
                  className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                  title="Remove column"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button type="submit" disabled={busy} className="rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">
            {busy ? 'Creating…' : 'Create database'}
          </button>
        </form>
      )}

      {!table ? (
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-500" />
          <div className="mt-2 font-display text-base font-semibold text-white">No community database selected</div>
          <p className="mt-1 text-xs text-slate-400">Create a database or pick one above to browse and edit rows.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#12151A] px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-white">{table.name}</h2>
              <div className="font-mono text-[10px] text-slate-500">
                {table.serverName} · {table.columns.length} columns · {rows.length} rows {table.description ? `· ${table.description}` : ''}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rows…" className="w-40 rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none" />
              </div>
              <button type="button" onClick={() => void loadRows(table.id)} className="rounded-lg border border-white/10 bg-[#171A21] p-2 text-slate-300 hover:bg-[#262B36]" title="Reload rows"><RefreshCw className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-[#262B36]" title="Schema & settings"><Settings2 className="h-3.5 w-3.5" /> Schema</button>
              <button type="button" onClick={() => void duplicateTable()} className="rounded-lg border border-white/10 bg-[#171A21] p-2 text-slate-300 hover:bg-[#262B36]" title="Duplicate database"><Copy className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-[#262B36]"><FileUp className="h-3.5 w-3.5" /> Import</button>
              <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-[#262B36]"><Download className="h-3.5 w-3.5" /> CSV</button>
              <button type="button" onClick={() => { setNewCells({}); setShowAddRow((v) => !v); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"><Plus className="h-3.5 w-3.5" /> Add row</button>
              <button type="button" onClick={() => void handleDeleteTable()} className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20" title="Delete database"><Trash2 className="h-3.5 w-3.5" /></button>
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importCsv(file);
                }}
              />
            </div>
          </div>

          {showAddRow && (
            <form onSubmit={handleAddRow} className="rounded-xl border border-emerald-500/35 bg-[#12151A] p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
                <span>New record in {table.name}</span>
                <button type="button" onClick={() => setShowAddRow(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {table.columns.map((col) => (
                  <div key={col.id} className="space-y-1">
                    <label className="block text-[10px] font-medium text-slate-400">{col.name}</label>
                    {col.type === 'checkbox' ? (
                      <label className="inline-flex items-center gap-2 pt-1 text-xs text-slate-200">
                        <input type="checkbox" checked={Boolean(newCells[col.id])} onChange={(e) => setNewCells((p) => ({ ...p, [col.id]: e.target.checked }))} className="rounded border-white/20 bg-[#0D0F12]" />
                        Checked
                      </label>
                    ) : col.type === 'status' ? (
                      <select
                        value={String(newCells[col.id] ?? col.options?.[0] ?? 'Planned')}
                        onChange={(e) => setNewCells((p) => ({ ...p, [col.id]: e.target.value }))}
                        className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                      >
                        {(col.options?.length ? col.options : ['Planned', 'In Progress', 'Shipped']).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'url' ? 'url' : 'text'}
                        value={String(newCells[col.id] ?? '')}
                        onChange={(e) => setNewCells((p) => ({ ...p, [col.id]: col.type === 'number' ? Number(e.target.value) : e.target.value }))}
                        placeholder={col.name}
                        className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
              <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Insert record</button>
            </form>
          )}

          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-[#0F1216] text-slate-400">
                <tr>
                  {table.columns.map((col) => (
                    <th key={col.id} className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          if (sortColId === col.id) setSortAsc((s) => !s);
                          else { setSortColId(col.id); setSortAsc(true); }
                        }}
                        className="inline-flex items-center gap-1.5 hover:text-white"
                      >
                        {col.name} <ArrowDownUp className="h-3 w-3 opacity-60" />
                      </button>
                      <span className="ml-2 font-mono text-[9px] uppercase text-slate-600">{col.type}</span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right"><Columns3 className="ml-auto h-3.5 w-3.5" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {loadingRows ? (
                  <tr><td colSpan={table.columns.length + 1} className="px-4 py-8 text-center text-slate-500"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={table.columns.length + 1} className="px-4 py-8 text-center text-slate-500">No rows. Add a record or import a CSV to get started.</td></tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-white/[0.02]">
                    {table.columns.map((col) => {
                      const value = row.cells[col.id];
                      const isEditing = editing?.rowId === row.id && editing?.colId === col.id;
                      if (col.type === 'checkbox') {
                        return (
                          <td key={col.id} className="px-4 py-2.5">
                            <button type="button" onClick={() => void updateCell(row, col, !Boolean(value))} className={`flex h-5 w-5 items-center justify-center rounded border ${Boolean(value) ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-white/20 bg-[#0D0F12] text-transparent'}`}>
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        );
                      }
                      if (col.type === 'status') {
                        const options = col.options?.length ? col.options : ['Planned', 'In Progress', 'Shipped'];
                        const current = String(value || options[0]);
                        const next = options[(options.indexOf(current) + 1) % options.length];
                        return (
                          <td key={col.id} className="px-4 py-2.5">
                            <button type="button" onClick={() => void updateCell(row, col, next)} title="Click to cycle status" className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${statusStyle(current)}`}>{current}</button>
                          </td>
                        );
                      }

                      if (isEditing) {
                        return (
                          <td key={col.id} className="px-3 py-2">
                            <input
                              autoFocus
                              type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'url' ? 'url' : 'text'}
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onBlur={() => {
                                const parsed = col.type === 'number' ? Number(editing.value || 0) : editing.value;
                                setEditing(null);
                                void updateCell(row, col, parsed);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const parsed = col.type === 'number' ? Number(editing.value || 0) : editing.value;
                                  setEditing(null);
                                  void updateCell(row, col, parsed);
                                } else if (e.key === 'Escape') setEditing(null);
                              }}
                              className="w-full rounded border border-[#5865F2] bg-[#0D0F12] px-2 py-1 text-xs text-white focus:outline-none"
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={col.id} onClick={() => setEditing({ rowId: row.id, colId: col.id, value: String(value ?? '') })} className="cursor-pointer px-4 py-2.5 text-slate-200 hover:text-white">
                          {value === undefined || value === '' ? <span className="text-slate-600">—</span> : col.type === 'url' ? (
                            <a href={String(value)} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">{String(value)}</a>
                          ) : (
                            String(value)
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => void handleDeleteRow(row.id)} title="Delete row" className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showSettings && table && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-[#12151A] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-white">Database schema · {table.name}</h2>
                <p className="text-[11px] text-slate-400">{table.serverName} · {rows.length} rows</p>
              </div>
              <button type="button" onClick={() => setShowSettings(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={saveSettings} className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Name</span>
                <input value={settingsForm.name} onChange={(e) => setSettingsForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Description</span>
                <input value={settingsForm.description} onChange={(e) => setSettingsForm((p) => ({ ...p, description: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none" />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">Save details</button>
              </div>
            </form>

            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Columns ({table.columns.length}/16)</div>
              <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
                {table.columns.map((col) => (
                  <div key={col.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-slate-200">{col.name}</span>
                      <span className="ml-2 font-mono text-[10px] uppercase text-slate-500">{col.type}</span>
                      {col.options?.length ? <span className="ml-2 font-mono text-[10px] text-slate-500">{col.options.join(' / ')}</span> : null}
                    </div>
                    <button type="button" onClick={() => void deleteColumn(col)} className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300" title="Delete column">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {table.columns.length < 16 && <AddColumnRow onAdd={addColumn} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function AddColumnRow({ onAdd }: { onAdd: (name: string, type: DatabaseColumnType) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseColumnType>('text');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), type);
        setName('');
        setType('text');
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New column name" className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-[#5865F2] focus:outline-none" />
      <select value={type} onChange={(e) => setType(e.target.value as DatabaseColumnType)} className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-xs text-white">
        {COLUMN_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]">
        <Plus className="h-3.5 w-3.5" /> Add column
      </button>
    </form>
  );
}
