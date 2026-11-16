import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, LifeBuoy, Loader2, Search, Send, ShieldCheck } from 'lucide-react';
import type { SupportTicket, TicketPriority, TicketStatus } from '../../../shared/types.ts';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'];
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const AdminSupportPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'URGENT' | 'CLOSED'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ tickets: SupportTicket[] }>('/api/admin/support');
      setTickets(res.tickets);
      setSelectedId((current) => current || res.tickets[0]?.id || null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load support inbox', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (statusFilter === 'OPEN' && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) return false;
      if (statusFilter === 'URGENT' && ticket.priority !== 'URGENT') return false;
      if (statusFilter === 'CLOSED' && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') return false;
      if (!q) return true;
      return (
        ticket.subject.toLowerCase().includes(q) ||
        ticket.username.toLowerCase().includes(q) ||
        ticket.email.toLowerCase().includes(q)
      );
    });
  }, [tickets, search, statusFilter]);

  const selected = tickets.find((t) => t.id === selectedId) || null;

  const patchTicket = async (patch: { status?: TicketStatus; priority?: TicketPriority }) => {
    if (!selected) return;
    try {
      const res = await apiRequest<{ ticket: SupportTicket }>(`/api/admin/support/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setTickets((prev) => prev.map((t) => (t.id === res.ticket.id ? res.ticket : t)));
      pushToast({ type: 'success', title: 'Ticket updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await apiRequest<{ ticket: SupportTicket }>(`/api/admin/support/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply('');
      setTickets((prev) => prev.map((t) => (t.id === res.ticket.id ? res.ticket : t)));
      pushToast({ type: 'success', title: 'Reply sent to member' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Reply failed', description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading support inbox…
      </div>
    );
  }

  const openCount = tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
  const urgentCount = tickets.filter((t) => t.priority === 'URGENT' && t.status !== 'CLOSED').length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Total tickets', tickets.length, 'text-white'],
          ['Open queue', openCount, 'text-amber-300'],
          ['Urgent', urgentCount, 'text-rose-300'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
            <div className="text-xs text-slate-400">{label}</div>
            <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.07] bg-[#12151A] p-1">
          {(['ALL', 'OPEN', 'URGENT', 'CLOSED'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                statusFilter === key ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {key === 'ALL' ? 'All tickets' : key === 'CLOSED' ? 'Resolved' : key === 'OPEN' ? 'Open queue' : 'Urgent'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="w-56 rounded-lg border border-white/10 bg-[#12151A] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
          />
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center">
          <LifeBuoy className="mx-auto h-8 w-8 text-slate-500" />
          <div className="mt-2 font-display text-base font-semibold text-white">Support inbox is clear</div>
          <p className="mt-1 text-xs text-slate-400">New member tickets appear here in real time.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="max-h-[34rem] space-y-1.5 overflow-y-auto lg:col-span-5">
            {filtered.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === ticket.id ? 'border-[#5865F2]/60 bg-[#5865F2]/10' : 'border-white/[0.07] bg-[#12151A] hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{ticket.subject}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                  <span className="rounded bg-white/[0.06] px-1 text-slate-300">@{ticket.username}</span>
                  <span className="text-slate-500">{ticket.category}</span>
                  <span className={ticket.priority === 'URGENT' ? 'text-rose-300' : 'text-slate-500'}>{ticket.priority}</span>
                  <span className="text-slate-500">· {ticket.status.replaceAll('_', ' ')}</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">No tickets match this filter.</p>}
          </div>

          <div className="lg:col-span-7">
            {selected && (
              <div className="flex h-full flex-col rounded-xl border border-white/[0.07] bg-[#12151A]">
                <div className="space-y-2 border-b border-white/[0.06] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">{selected.subject}</h2>
                      <div className="mt-1 font-mono text-[10px] text-slate-500">
                        @{selected.username} · {selected.email} · {selected.id}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      <ShieldCheck className="h-3 w-3" /> Staff view
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Ticket status"
                      value={selected.status}
                      onChange={(e) => void patchTicket({ status: e.target.value as TicketStatus })}
                      className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-[11px] text-white"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                    </select>
                    <select
                      aria-label="Ticket priority"
                      value={selected.priority}
                      onChange={(e) => void patchTicket({ priority: e.target.value as TicketPriority })}
                      className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-[11px] text-white"
                    >
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '22rem' }}>
                  {selected.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-lg border p-3 ${
                        msg.isStaff ? 'border-emerald-500/25 bg-emerald-500/[0.07]' : 'border-white/[0.06] bg-[#0D0F12]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className={msg.isStaff ? 'font-semibold text-emerald-300' : 'font-semibold text-slate-200'}>
                          {msg.authorName} {msg.isStaff && '· Staff'}
                        </span>
                        <span className="font-mono text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{msg.body}</p>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleReply} className="space-y-2 border-t border-white/[0.06] p-3">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder="Reply as platform staff…"
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send staff reply'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
