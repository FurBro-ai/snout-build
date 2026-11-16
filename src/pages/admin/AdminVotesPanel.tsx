import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, Loader2, MessageSquare, Save, Search, Trash2, TrendingUp } from 'lucide-react';
import type { CommunityIdea, IdeaStatus } from '../../../shared/types.ts';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';

const STATUSES: IdeaStatus[] = ['UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'DECLINED'];

export const AdminVotesPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [ideas, setIdeas] = useState<CommunityIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | IdeaStatus>('ALL');
  const [drafts, setDrafts] = useState<Record<string, { status: IdeaStatus; adminResponse: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ ideas: CommunityIdea[] }>('/api/admin/community/ideas');
      setIdeas(res.ideas);
      const next: Record<string, { status: IdeaStatus; adminResponse: string }> = {};
      for (const idea of res.ideas) next[idea.id] = { status: idea.status, adminResponse: idea.adminResponse };
      setDrafts(next);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load ideas', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (statusFilter !== 'ALL' && idea.status !== statusFilter) return false;
      if (!q) return true;
      return (
        idea.title.toLowerCase().includes(q) ||
        idea.authorName.toLowerCase().includes(q) ||
        idea.category.toLowerCase().includes(q)
      );
    });
  }, [ideas, statusFilter, search]);

  const handleSave = async (idea: CommunityIdea) => {
    const draft = drafts[idea.id];
    if (!draft) return;
    setSavingId(idea.id);
    try {
      const res = await apiRequest<{ idea: CommunityIdea }>(`/api/admin/community/ideas/${idea.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: draft.status, adminResponse: draft.adminResponse }),
      });
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, ...res.idea } : i)));
      pushToast({ type: 'success', title: 'Roadmap idea updated' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Update failed', description: (err as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (idea: CommunityIdea) => {
    if (!window.confirm(`Delete "${idea.title}"?`)) return;
    try {
      await apiRequest(`/api/admin/community/ideas/${idea.id}`, { method: 'DELETE' });
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      pushToast({ type: 'info', title: 'Idea deleted' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading roadmap ideas…
      </div>
    );
  }

  const totalVotes = ideas.reduce((sum, i) => sum + i.upvoterIds.length, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Ideas', ideas.length, 'text-white'],
          ['Total votes', totalVotes, 'text-indigo-300'],
          ['Shipped', ideas.filter((i) => i.status === 'SHIPPED').length, 'text-emerald-300'],
          ['Awaiting triage', ideas.filter((i) => i.status === 'UNDER_REVIEW').length, 'text-amber-300'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
            <div className="text-xs text-slate-400">{label}</div>
            <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.07] bg-[#12151A] p-1">
          {(['ALL', ...STATUSES] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                statusFilter === key ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {key === 'ALL' ? 'All' : key.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ideas…"
            className="w-56 rounded-lg border border-white/10 bg-[#12151A] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-8 text-center text-xs text-slate-500">
            No ideas match this filter.
          </div>
        ) : (
          filtered.map((idea) => {
            const draft = drafts[idea.id] || { status: idea.status, adminResponse: idea.adminResponse };
            return (
              <div key={idea.id} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-sm font-semibold text-white">{idea.title}</h3>
                      <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400">{idea.category}</span>
                      <span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                        <ArrowUp className="h-3 w-3" /> {idea.upvoterIds.length}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs text-slate-400">{idea.description}</p>
                    <div className="mt-1 font-mono text-[10px] text-slate-500">by @{idea.author?.username || idea.authorName} · {new Date(idea.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={draft.status}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [idea.id]: { ...draft, status: e.target.value as IdeaStatus } }))}
                      className="rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 text-[11px] text-white"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleSave(idea)}
                      disabled={savingId === idea.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#5865F2] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                    >
                      <Save className="h-3 w-3" /> Save
                    </button>
                    <button type="button" onClick={() => void handleDelete(idea)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300" title="Delete idea">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                    <MessageSquare className="h-3 w-3" /> Public staff response
                  </span>
                  <input
                    value={draft.adminResponse}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [idea.id]: { ...draft, adminResponse: e.target.value } }))}
                    placeholder="Explain the decision or next step…"
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                  />
                </label>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
