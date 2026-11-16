import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Globe2,
  Gauge,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Server,
  SignalHigh,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { VoiceNodeStatus, VoiceRegionGroup } from '../../../shared/types.ts';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';

interface AdminVoiceNode {
  id: string;
  name: string;
  regionLabel: string;
  regionCode: string;
  regionGroup: VoiceRegionGroup;
  host: string;
  turnPort: number;
  tlsPort: number | null;
  stunUrls: string[];
  turnSecret: string;
  turnSecretSet: boolean;
  turnUrls: string[];
  healthUrl: string | null;
  priority: number;
  capacity: number;
  enabled: boolean;
  status: VoiceNodeStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastClientReportAt?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface VoiceNodeForm {
  id: string;
  name: string;
  regionLabel: string;
  regionCode: string;
  regionGroup: VoiceRegionGroup;
  host: string;
  turnPort: string;
  tlsPort: string;
  priority: string;
  capacity: string;
  stunUrls: string;
  turnSecret: string;
  healthUrl: string;
  notes: string;
  enabled: boolean;
}

const EMPTY_FORM: VoiceNodeForm = {
  id: '',
  name: '',
  regionLabel: '',
  regionCode: '',
  regionGroup: 'europe',
  host: '',
  turnPort: '3478',
  tlsPort: '',
  priority: '50',
  capacity: '250',
  stunUrls: '',
  turnSecret: '',
  healthUrl: '',
  notes: '',
  enabled: true,
};

const REGION_GROUPS: Array<{ value: VoiceRegionGroup; label: string }> = [
  { value: 'oceania', label: 'Oceania' },
  { value: 'europe', label: 'Europe' },
  { value: 'north-america', label: 'North America' },
  { value: 'south-america', label: 'South America' },
  { value: 'asia', label: 'Asia' },
  { value: 'africa', label: 'Africa' },
  { value: 'middle-east', label: 'Middle East' },
  { value: 'global', label: 'Global / Anycast' },
];

function statusTone(status: VoiceNodeStatus): string {
  if (status === 'ONLINE') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'DEGRADED') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  if (status === 'OFFLINE') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return 'border-white/15 bg-white/5 text-slate-300';
}

function statusIcon(status: VoiceNodeStatus) {
  if (status === 'ONLINE') return <Wifi className="h-3.5 w-3.5" />;
  if (status === 'OFFLINE') return <WifiOff className="h-3.5 w-3.5" />;
  return <SignalHigh className="h-3.5 w-3.5" />;
}

function regionFlag(group: VoiceRegionGroup): string {
  switch (group) {
    case 'oceania': return '🌏';
    case 'europe': return '🇪🇺';
    case 'north-america': return '🌎';
    case 'south-america': return '🌎';
    case 'asia': return '🌏';
    case 'africa': return '🌍';
    case 'middle-east': return '🌍';
    default: return '🌐';
  }
}

function toForm(node: AdminVoiceNode): VoiceNodeForm {
  return {
    id: node.id,
    name: node.name,
    regionLabel: node.regionLabel,
    regionCode: node.regionCode,
    regionGroup: node.regionGroup,
    host: node.host,
    turnPort: String(node.turnPort),
    tlsPort: node.tlsPort ? String(node.tlsPort) : '',
    priority: String(node.priority),
    capacity: String(node.capacity),
    stunUrls: node.stunUrls.join(', '),
    turnSecret: '',
    healthUrl: node.healthUrl || '',
    notes: node.notes,
    enabled: node.enabled,
  };
}

export const AdminVoiceServersPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [nodes, setNodes] = useState<AdminVoiceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [testingId, setTestingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<VoiceNodeForm | null>(null);
  const [deleteId, setDeleteId] = useState('');
  const [secretReveal, setSecretReveal] = useState<{ nodeId: string; secret: string; instruction: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ nodes: AdminVoiceNode[] }>('/api/admin/voice-servers');
      setNodes(res.nodes);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load voice servers', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const enabled = nodes.filter((n) => n.enabled);
    return {
      total: nodes.length,
      online: enabled.filter((n) => n.status === 'ONLINE').length,
      degraded: enabled.filter((n) => n.status === 'DEGRADED').length,
      offline: enabled.filter((n) => n.status === 'OFFLINE').length,
      capacity: enabled.reduce((sum, n) => sum + n.capacity, 0),
      regions: new Set(enabled.map((n) => n.regionGroup)).size,
      bestLatency: enabled
        .map((n) => n.latencyMs)
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b)[0] ?? null,
    };
  }, [nodes]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        regionLabel: form.regionLabel,
        regionCode: form.regionCode,
        regionGroup: form.regionGroup,
        host: form.host,
        turnPort: Number(form.turnPort),
        tlsPort: form.tlsPort ? Number(form.tlsPort) : null,
        priority: Number(form.priority),
        capacity: Number(form.capacity),
        stunUrls: form.stunUrls
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        healthUrl: form.healthUrl.trim(),
        notes: form.notes,
        enabled: form.enabled,
        ...(form.turnSecret ? { turnSecret: form.turnSecret } : {}),
      };
      if (form.id) {
        await apiRequest(`/api/admin/voice-servers/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        pushToast({ type: 'success', title: 'Voice server updated', description: `${form.name} saved.` });
      } else {
        await apiRequest('/api/admin/voice-servers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        pushToast({ type: 'success', title: 'Voice server added', description: `${form.name} is now in the fleet.` });
      }
      setForm(null);
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not save voice server', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (node: AdminVoiceNode) => {
    setTestingId(node.id);
    try {
      const res = await apiRequest<{ health: { reachable: boolean; detail: string; latencyMs: number | null } }>(
        `/api/admin/voice-servers/${node.id}/test`,
        { method: 'POST' }
      );
      pushToast({
        type: res.health.reachable ? 'success' : 'error',
        title: res.health.reachable ? `${node.name} is reachable` : `${node.name} is unreachable`,
        description: res.health.detail,
      });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Health probe failed', description: (err as Error).message });
    } finally {
      setTestingId('');
    }
  };

  const handleTestAll = async () => {
    setTestingAll(true);
    try {
      const res = await apiRequest<{ results: Array<{ reachable: boolean }> }>('/api/admin/voice-servers/test-all', {
        method: 'POST',
      });
      const reachable = res.results.filter((r) => r.reachable).length;
      pushToast({
        type: reachable === res.results.length ? 'success' : 'info',
        title: 'Fleet health sweep complete',
        description: `${reachable}/${res.results.length} relays reachable on TURN.`,
      });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Fleet probe failed', description: (err as Error).message });
    } finally {
      setTestingAll(false);
    }
  };

  const toggleEnabled = async (node: AdminVoiceNode) => {
    try {
      await apiRequest(`/api/admin/voice-servers/${node.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !node.enabled }),
      });
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, enabled: !n.enabled } : n)));
      pushToast({
        type: 'info',
        title: `${node.name} ${node.enabled ? 'disabled' : 'enabled'}`,
        description: node.enabled ? 'Clients will stop selecting this relay.' : 'Relay is back in the auto-selection pool.',
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not update relay', description: (err as Error).message });
    }
  };

  const rotateSecret = async (node: AdminVoiceNode) => {
    if (!window.confirm(`Rotate the TURN shared secret for ${node.name}? Active calls keep working until credentials expire (60 min).`)) {
      return;
    }
    try {
      const res = await apiRequest<{ turnSecret: string; instruction: string }>(
        `/api/admin/voice-servers/${node.id}/rotate-secret`,
        { method: 'POST' }
      );
      setSecretReveal({ nodeId: node.id, secret: res.turnSecret, instruction: res.instruction });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Secret rotation failed', description: (err as Error).message });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiRequest(`/api/admin/voice-servers/${deleteId}`, { method: 'DELETE' });
      pushToast({ type: 'info', title: 'Voice server removed' });
      setDeleteId('');
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not remove voice server', description: (err as Error).message });
    }
  };

  const duplicate = async (node: AdminVoiceNode) => {
    try {
      await apiRequest(`/api/admin/voice-servers/${node.id}/duplicate`, { method: 'POST' });
      pushToast({ type: 'success', title: 'Relay duplicated', description: 'The copy is disabled until you configure its host.' });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: 'Duplicate failed', description: (err as Error).message });
    }
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast({ type: 'success', title: 'Copied to clipboard' });
    } catch {
      pushToast({ type: 'error', title: 'Clipboard unavailable', description: 'Copy the value manually.' });
    }
  };

  const deleting = nodes.find((n) => n.id === deleteId) || null;

  return (
    <div className="space-y-5">
      {/* Fleet summary */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Relay fleet</span>
            <Radio className="h-4 w-4 text-indigo-300" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">{stats.total}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {stats.online} online · {stats.degraded} degraded · {stats.offline} offline
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Global regions</span>
            <Globe2 className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">{stats.regions}</div>
          <div className="mt-1 text-[11px] text-slate-400">Auto-selection covers every enabled node</div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Concurrent capacity</span>
            <Gauge className="h-4 w-4 text-amber-300" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">{stats.capacity.toLocaleString()}</div>
          <div className="mt-1 text-[11px] text-slate-400">Sum of enabled relay capacities</div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Best TURN RTT</span>
            <Zap className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-emerald-300 tabular-nums">
            {stats.bestLatency === null ? '—' : `${stats.bestLatency}ms`}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Server-side TCP probe to relay</div>
        </div>
      </div>

      {/* Auto-selection explainer + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.07] px-4 py-3">
        <div className="flex items-start gap-2.5 text-xs text-indigo-100">
          <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
          <p className="max-w-2xl">
            <span className="font-semibold">Auto server selection is live.</span> Each client probes every enabled relay with
            real WebRTC ICE gathering, picks the lowest-latency TURN candidate for its own network, then falls back to
            timezone region and admin priority. Add nodes anywhere on the planet — no client update required.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleTestAll()}
            disabled={testingAll || nodes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {testingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Test fleet
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...EMPTY_FORM })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
          >
            <Plus className="h-3.5 w-3.5" /> Add voice server
          </button>
        </div>
      </div>

      {/* Node list */}
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading relay fleet…
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-[#12151A] p-10 text-center">
          <Server className="mx-auto h-9 w-9 text-slate-500" />
          <div className="mt-2 font-display text-base font-semibold text-white">No voice servers yet</div>
          <p className="mt-1 text-xs text-slate-400">Add your first TURN relay to power global voice and auto-selection.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#12151A]">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)] gap-3 border-b border-white/[0.06] bg-[#0F1216] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:grid">
            <span>Relay</span>
            <span>Region</span>
            <span>Latency</span>
            <span>Priority</span>
            <span className="text-right">Controls</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {nodes.map((node) => (
              <div
                key={node.id}
                className="grid gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${statusTone(node.status)}`}>
                      {statusIcon(node.status)} {node.status}
                    </span>
                    <span className="truncate text-sm font-semibold text-white">{node.name}</span>
                    {!node.enabled && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">disabled</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-400">
                    <span>{node.host}:{node.turnPort}</span>
                    <span className="text-slate-600">·</span>
                    <span>{node.turnSecretSet ? 'TURN secret set' : 'STUN only'}</span>
                    <span className="text-slate-600">·</span>
                    <span>{node.capacity} slots</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span aria-hidden="true">{regionFlag(node.regionGroup)}</span>
                  <span className="truncate">{node.regionLabel}</span>
                </div>
                <div className="font-mono text-xs tabular-nums">
                  {node.latencyMs === null ? (
                    <span className="text-slate-500">probe pending</span>
                  ) : (
                    <span className={node.latencyMs < 150 ? 'text-emerald-300' : node.latencyMs < 400 ? 'text-amber-300' : 'text-rose-300'}>
                      {node.latencyMs}ms
                    </span>
                  )}
                  <div className="text-[10px] text-slate-500">
                    {node.lastClientReportAt
                      ? `client ${new Date(node.lastClientReportAt).toLocaleTimeString()}`
                      : node.lastCheckedAt
                        ? `probe ${new Date(node.lastCheckedAt).toLocaleTimeString()}`
                        : 'never'}
                  </div>
                </div>
                <div className="font-mono text-xs text-slate-300 tabular-nums">{node.priority}</div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleTest(node)}
                    disabled={testingId === node.id}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#171A21] px-2 py-1 text-[11px] text-slate-200 hover:bg-[#242A35] disabled:opacity-50"
                    title="Probe TURN reachability"
                  >
                    {testingId === node.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(toForm(node))}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#171A21] px-2 py-1 text-[11px] text-slate-200 hover:bg-[#242A35]"
                    title="Edit relay"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(node)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      node.enabled
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                        : 'border-white/10 bg-[#171A21] text-slate-300 hover:bg-[#242A35]'
                    }`}
                  >
                    {node.enabled ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rotateSecret(node)}
                    className="rounded-md border border-white/10 bg-[#171A21] p-1.5 text-slate-300 hover:bg-[#242A35]"
                    title="Rotate TURN secret"
                  >
                    <KeyRound className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void duplicate(node)}
                    className="rounded-md border border-white/10 bg-[#171A21] p-1.5 text-slate-300 hover:bg-[#242A35]"
                    title="Duplicate relay"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(node.id)}
                    className="rounded-md border border-rose-500/25 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                    title="Remove relay"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {node.notes && (
                  <div className="text-[11px] text-slate-500 lg:col-span-5">{node.notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create / edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <form onSubmit={handleSave} className="w-full max-w-3xl space-y-4 rounded-2xl border border-white/10 bg-[#12151A] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  {form.id ? 'Edit voice server' : 'Add voice server'}
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Every enabled relay joins the client-side latency race automatically.
                </p>
              </div>
              <button type="button" onClick={() => setForm(null)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" required>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Frankfurt Edge" className={inputClass} />
              </Field>
              <Field label="Region label" required>
                <input required value={form.regionLabel} onChange={(e) => setForm({ ...form, regionLabel: e.target.value })} placeholder="Frankfurt, Germany" className={inputClass} />
              </Field>
              <Field label="Region code" required hint="Lowercase slug, e.g. eu-fra">
                <input required value={form.regionCode} onChange={(e) => setForm({ ...form, regionCode: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="eu-fra" className={inputClass} />
              </Field>
              <Field label="Region group" required>
                <select value={form.regionGroup} onChange={(e) => setForm({ ...form, regionGroup: e.target.value as VoiceRegionGroup })} className={inputClass}>
                  {REGION_GROUPS.map((group) => (
                    <option key={group.value} value={group.value}>{group.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Public host / IP" required>
                <input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value.trim() })} placeholder="203.0.113.10" className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="TURN port" required>
                  <input required type="number" min={1} max={65535} value={form.turnPort} onChange={(e) => setForm({ ...form, turnPort: e.target.value })} className={inputClass} />
                </Field>
                <Field label="TLS port" hint="Optional">
                  <input type="number" min={1} max={65535} value={form.tlsPort} onChange={(e) => setForm({ ...form, tlsPort: e.target.value })} placeholder="5349" className={inputClass} />
                </Field>
              </div>
              <Field label="Priority" hint="Lower runs first when RTT ties">
                <input type="number" min={0} max={999} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Capacity" hint="Concurrent participants">
                <input type="number" min={1} max={100000} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className={inputClass} />
              </Field>
              <Field label="STUN URLs" hint="Comma separated; blank auto-generates" className="sm:col-span-2">
                <input value={form.stunUrls} onChange={(e) => setForm({ ...form, stunUrls: e.target.value })} placeholder="stun:203.0.113.10:3478" className={inputClass} />
              </Field>
              <Field label="Health URL" hint="Optional HTTP JSON probe" className="sm:col-span-2">
                <input value={form.healthUrl} onChange={(e) => setForm({ ...form, healthUrl: e.target.value })} placeholder="https://voice.example.com/health" className={inputClass} />
              </Field>
              <Field label={form.id ? 'TURN shared secret — leave blank to keep' : 'TURN shared secret'} hint="Must match static-auth-secret on the relay" className="sm:col-span-2">
                <input
                  type="password"
                  value={form.turnSecret}
                  onChange={(e) => setForm({ ...form, turnSecret: e.target.value })}
                  placeholder={form.id ? 'Unchanged unless you type a new secret' : 'Paste coturn static-auth-secret'}
                  className={inputClass}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Maintenance window, provider, bandwidth…" className={`${inputClass} resize-none`} />
              </Field>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="rounded border-white/20 bg-[#0D0F12]" />
              Enabled for auto-selection
            </label>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-[#171A21] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#242A35]">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {form.id ? 'Save changes' : 'Add voice server'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-rose-500/30 bg-[#12151A] p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle className="h-4 w-4" />
              <h2 className="font-display text-sm font-semibold">Remove {deleting.name}?</h2>
            </div>
            <p className="text-xs text-slate-400">
              Clients will immediately stop selecting this relay. The coturn process on <span className="font-mono">{deleting.host}</span> is not touched.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteId('')} className="rounded-lg border border-white/10 bg-[#171A21] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#242A35]">Cancel</button>
              <button type="button" onClick={() => void handleDelete()} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">Remove relay</button>
            </div>
          </div>
        </div>
      )}

      {/* Rotated secret reveal */}
      {secretReveal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl space-y-4 rounded-2xl border border-emerald-500/30 bg-[#12151A] p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-emerald-300">
              <KeyRound className="h-4 w-4" />
              <h2 className="font-display text-sm font-semibold">New TURN secret generated</h2>
            </div>
            <p className="text-xs text-slate-400">{secretReveal.instruction}</p>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0D0F12] p-3">
              <code className="flex-1 break-all font-mono text-xs text-emerald-300">{secretReveal.secret}</code>
              <button type="button" onClick={() => void copyValue(secretReveal.secret)} className="rounded-md border border-white/10 p-1.5 text-slate-300 hover:bg-white/10" title="Copy secret">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              This value is only shown once. Update <span className="font-mono">static-auth-secret</span> on the relay, restart coturn, then test the node.
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setSecretReveal(null)} className="rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const inputClass =
  'w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-[#5865F2] focus:outline-none';

function Field({
  label,
  hint,
  required,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}
