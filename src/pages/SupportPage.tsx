import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Ticket,
  XCircle,
} from 'lucide-react';
import type { SupportTicket, TicketCategory, TicketStatus } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

const CATEGORIES: TicketCategory[] = ['Account', 'Billing', 'Bug Report', 'Feature Request', 'Safety', 'Other'];

const STATUS_STYLE: Record<TicketStatus, { label: string; className: string }> = {
  OPEN: { label: 'Open', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  IN_PROGRESS: { label: 'In progress', className: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' },
  WAITING_ON_USER: { label: 'Awaiting your reply', className: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' },
  RESOLVED: { label: 'Resolved', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  CLOSED: { label: 'Closed', className: 'border-white/15 bg-white/5 text-slate-400' },
};

const FAQS = [
  {
    q: 'How do I activate SNOUT NITRO?',
    a: 'Open the Nitro page from the left rail, choose a payment method, and complete the Platega checkout. Nitro activates only after Platega sends a verified server-side webhook.',
  },
  {
    q: 'A payment succeeded but Nitro is missing. What now?',
    a: 'Open a Billing ticket with your order ID (it starts with snout-nitro-). Platform admins can reconcile the Platega ledger and activate Nitro manually from Admin Console → Payments.',
  },
  {
    q: 'How do I report a security issue?',
    a: 'Choose the Safety category and include reproduction steps. Never post exploit details in public channels. Admins can award the Bug Hunter badge for confirmed reports.',
  },
  {
    q: 'Can I recover my account if 2FA is lost?',
    a: 'Open an Account ticket from the email on the account. A platform admin can revoke sessions and perform an emergency 2FA reset after identity checks.',
  },
];

export const SupportPage: React.FC = () => {
  const { pushToast } = useChordStore();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<TicketCategory>('Other');
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH'>('NORMAL');
  const [creating, setCreating] = useState(false);
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ tickets: SupportTicket[] }>('/api/support/tickets');
      setTickets(res.tickets);
      setSelectedId((current) => current || res.tickets[0]?.id || null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load tickets', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) || null,
    [tickets, selectedId]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await apiRequest<{ ticket: SupportTicket }>('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim(), message: message.trim(), category, priority }),
      });
      setSubject('');
      setMessage('');
      setCategory('Other');
      setPriority('NORMAL');
      await load();
      setSelectedId(res.ticket.id);
      pushToast({ type: 'success', title: 'Ticket opened', description: 'Our team will reply in this thread.' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not open ticket', description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setSendingReply(true);
    try {
      const res = await apiRequest<{ ticket: SupportTicket }>(
        `/api/support/tickets/${selected.id}/messages`,
        { method: 'POST', body: JSON.stringify({ body: reply.trim() }) }
      );
      setReply('');
      setTickets((prev) => prev.map((t) => (t.id === res.ticket.id ? res.ticket : t)));
      pushToast({ type: 'success', title: 'Reply sent' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Reply failed', description: (err as Error).message });
    } finally {
      setSendingReply(false);
    }
  };

  const handleClose = async () => {
    if (!selected) return;
    try {
      const res = await apiRequest<{ ticket: SupportTicket }>(
        `/api/support/tickets/${selected.id}/close`,
        { method: 'POST' }
      );
      setTickets((prev) => prev.map((t) => (t.id === res.ticket.id ? res.ticket : t)));
      pushToast({ type: 'info', title: 'Ticket closed' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not close ticket', description: (err as Error).message });
    }
  };

  const openCount = tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0F12] text-[#F1F3F5] p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <LifeBuoy className="h-4 w-4" />
              Support centre
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold text-white">We are here to help</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Open a ticket for account, billing, safety, or product issues. Replies arrive in this thread and in your
              notification drawer.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] px-4 py-2.5 text-center">
              <div className="font-mono text-xl font-bold text-white tabular-nums">{tickets.length}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">tickets</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] px-4 py-2.5 text-center">
              <div className="font-mono text-xl font-bold text-amber-300 tabular-nums">{openCount}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">open</div>
            </div>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Clock, title: 'First response', value: 'Usually under 24h', tone: 'text-indigo-300' },
            { icon: ShieldCheck, title: 'Safety reports', value: 'Prioritised immediately', tone: 'text-emerald-300' },
            { icon: Ticket, title: 'Ticket history', value: 'Kept with your account', tone: 'text-amber-300' },
          ].map((item) => (
            <div key={item.title} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
              <item.icon className={`h-5 w-5 ${item.tone}`} />
              <div>
                <div className="text-xs text-slate-400">{item.title}</div>
                <div className="text-sm font-semibold text-white">{item.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                <MessageSquarePlus className="h-4 w-4 text-[#5865F2]" />
                Open a new ticket
              </h2>
              <form onSubmit={handleCreate} className="mt-3 space-y-2.5">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  minLength={4}
                  maxLength={120}
                  placeholder="Subject"
                  className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    className="rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-2 text-xs text-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'LOW' | 'NORMAL' | 'HIGH')}
                    className="rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-2 text-xs text-white"
                  >
                    <option value="LOW">Low priority</option>
                    <option value="NORMAL">Normal priority</option>
                    <option value="HIGH">High priority</option>
                  </select>
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={5}
                  placeholder="Describe what happened, what you expected, and any order IDs or reproduction steps…"
                  className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full rounded-lg bg-[#5865F2] py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                >
                  {creating ? 'Opening ticket…' : 'Submit ticket'}
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
              <h2 className="font-display text-sm font-semibold text-white">Frequently asked</h2>
              <div className="mt-2 divide-y divide-white/[0.06]">
                {FAQS.map((faq, idx) => (
                  <div key={faq.q}>
                    <button
                      type="button"
                      onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                      className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-xs font-medium text-slate-200"
                    >
                      <span>{faq.q}</span>
                      {openFaq === idx ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                    {openFaq === idx && <p className="pb-3 text-[11px] leading-relaxed text-slate-400">{faq.a}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            {loading ? (
              <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your tickets…
              </div>
            ) : tickets.length === 0 ? (
              <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center">
                <LifeBuoy className="mx-auto h-8 w-8 text-slate-500" />
                <div className="mt-2 font-display text-base font-semibold text-white">No tickets yet</div>
                <p className="mt-1 text-xs text-slate-400">Use the form to open your first support conversation.</p>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-12">
                <div className="space-y-1.5 xl:col-span-5">
                  {tickets.map((ticket) => {
                    const status = STATUS_STYLE[ticket.status];
                    return (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => setSelectedId(ticket.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          selectedId === ticket.id
                            ? 'border-[#5865F2]/60 bg-[#5865F2]/10'
                            : 'border-white/[0.07] bg-[#12151A] hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-white">{ticket.subject}</span>
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                          <span>{ticket.category}</span>
                          <span>·</span>
                          <span>{ticket.priority}</span>
                          <span>·</span>
                          <span>{new Date(ticket.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="xl:col-span-7">
                  {selected && (
                    <div className="flex h-full flex-col rounded-xl border border-white/[0.07] bg-[#12151A]">
                      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-4">
                        <div>
                          <h2 className="text-sm font-semibold text-white">{selected.subject}</h2>
                          <div className="mt-1 font-mono text-[10px] text-slate-500">
                            {selected.id} · {selected.category} · {selected.priority}
                          </div>
                        </div>
                        {selected.status !== 'CLOSED' && (
                          <button
                            type="button"
                            onClick={() => void handleClose()}
                            className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400 hover:text-white"
                          >
                            <XCircle className="h-3 w-3" /> Close
                          </button>
                        )}
                      </div>

                      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '26rem' }}>
                        {selected.messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`rounded-lg border p-3 ${
                              msg.isStaff
                                ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                                : 'border-white/[0.06] bg-[#0D0F12]'
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

                      {selected.status !== 'CLOSED' ? (
                        <form onSubmit={handleReply} className="border-t border-white/[0.06] p-3 space-y-2">
                          <textarea
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            rows={3}
                            placeholder="Write a reply…"
                            className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={sendingReply || !reply.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {sendingReply ? 'Sending…' : 'Send reply'}
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 border-t border-white/[0.06] p-3 text-xs text-slate-400">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          This ticket is closed. Open a new ticket if you need more help.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
