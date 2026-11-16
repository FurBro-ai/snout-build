import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  CheckCircle2,
  Clock,
  Filter,
  Lightbulb,
  Loader2,
  Plus,
  Rocket,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { CommunityIdea, IdeaCategory, IdeaStatus } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

const STATUS_META: Record<
  IdeaStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  UNDER_REVIEW: {
    label: 'Under review',
    className: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
    icon: <Clock className="h-3 w-3" />,
  },
  PLANNED: {
    label: 'Planned',
    className: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
    icon: <Lightbulb className="h-3 w-3" />,
  },
  IN_PROGRESS: {
    label: 'In progress',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    icon: <Loader2 className="h-3 w-3" />,
  },
  SHIPPED: {
    label: 'Shipped',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  DECLINED: {
    label: 'Not planned',
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    icon: <X className="h-3 w-3" />,
  },
};

const CATEGORIES: IdeaCategory[] = ['Feature', 'Voice & Video', 'Bots & API', 'Design', 'Billing', 'Other'];

export const CommunityVotesPage: React.FC = () => {
  const { user, pushToast } = useChordStore();
  const [ideas, setIdeas] = useState<CommunityIdea[]>([]);
  const [stats, setStats] = useState({ total: 0, totalVotes: 0, shipped: 0, inProgress: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | IdeaStatus>('ALL');
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IdeaCategory>('Feature');
  const [submitting, setSubmitting] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        ideas: CommunityIdea[];
        stats: typeof stats;
      }>('/api/community/ideas');
      setIdeas(res.ideas);
      setStats(res.stats);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load roadmap', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ideas.filter((idea) => {
      if (statusFilter !== 'ALL' && idea.status !== statusFilter) return false;
      if (!q) return true;
      return (
        idea.title.toLowerCase().includes(q) ||
        idea.description.toLowerCase().includes(q) ||
        idea.category.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) =>
      sort === 'top'
        ? b.upvoterIds.length - a.upvoterIds.length
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [ideas, statusFilter, sort, search]);

  const handleVote = async (idea: CommunityIdea) => {
    setVotingId(idea.id);
    try {
      const res = await apiRequest<{ idea: CommunityIdea & { voteCount: number; hasUpvoted: boolean } }>(
        `/api/community/ideas/${idea.id}/vote`,
        { method: 'POST' }
      );
      setIdeas((prev) =>
        prev.map((item) =>
          item.id === idea.id
            ? {
                ...item,
                upvoterIds: res.idea.hasUpvoted
                  ? [...item.upvoterIds, user!.id]
                  : item.upvoterIds.filter((id) => id !== user!.id),
              }
            : item
        )
      );
    } catch (err) {
      pushToast({ type: 'error', title: 'Vote failed', description: (err as Error).message });
    } finally {
      setVotingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/community/ideas', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: description.trim(), category }),
      });
      setTitle('');
      setDescription('');
      setCategory('Feature');
      setShowCreate(false);
      await load();
      pushToast({ type: 'success', title: 'Idea submitted', description: 'The community can now upvote it.' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Submission failed', description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0F12] text-[#F1F3F5] p-6 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
              <Rocket className="h-4 w-4" />
              Community roadmap
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold text-white">Vote on what Snout builds next</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Submit ideas, upvote the features you need, and follow every status change. Platform admins triage the
              roadmap from the Admin Console.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
          >
            <Plus className="h-4 w-4" />
            Submit idea
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Ideas submitted', value: stats.total, accent: 'text-white' },
            { label: 'Votes cast', value: stats.totalVotes, accent: 'text-indigo-300' },
            { label: 'On the roadmap', value: stats.inProgress, accent: 'text-amber-300' },
            { label: 'Shipped', value: stats.shipped, accent: 'text-emerald-300' },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-white/[0.07] bg-[#12151A] p-4">
              <div className="text-xs text-slate-400">{card.label}</div>
              <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${card.accent}`}>{card.value}</div>
            </div>
          ))}
        </div>

        {showCreate && (
          <form onSubmit={handleSubmit} className="rounded-xl border border-[#5865F2]/40 bg-[#12151A] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-indigo-300" />
                New roadmap idea
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={4}
              maxLength={120}
              placeholder="Short, specific title — e.g. Stage rooms with hand-raise"
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              placeholder="What problem does this solve? Who benefits? Any implementation notes?"
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as IdeaCategory)}
                className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-slate-500">{description.length}/2000</span>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Publish idea'}
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.07] bg-[#12151A] p-1">
            {(['ALL', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'DECLINED'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                  statusFilter === key ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {key === 'ALL' ? 'All' : STATUS_META[key].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ideas…"
                className="w-48 rounded-lg border border-white/10 bg-[#12151A] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setSort((s) => (s === 'top' ? 'new' : 'top'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-200 hover:bg-[#1E222B]"
            >
              <Filter className="h-3.5 w-3.5" />
              {sort === 'top' ? 'Top voted' : 'Newest'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading community roadmap…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center">
            <Lightbulb className="mx-auto h-8 w-8 text-slate-500" />
            <div className="mt-2 font-display text-base font-semibold text-white">No ideas match this view</div>
            <p className="mt-1 text-xs text-slate-400">Try a different status filter or submit the first idea.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((idea) => {
              const upvoted = idea.upvoterIds.includes(user?.id || '');
              const status = STATUS_META[idea.status];
              return (
                <article
                  key={idea.id}
                  className="flex gap-4 rounded-xl border border-white/[0.07] bg-[#12151A] p-4 transition-colors hover:border-white/15"
                >
                  <button
                    type="button"
                    onClick={() => void handleVote(idea)}
                    disabled={votingId === idea.id}
                    aria-pressed={upvoted}
                    className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors ${
                      upvoted
                        ? 'border-[#5865F2] bg-[#5865F2]/20 text-indigo-200'
                        : 'border-white/10 bg-[#0D0F12] text-slate-300 hover:border-[#5865F2]/60 hover:text-white'
                    }`}
                  >
                    <ArrowUp className={`h-4 w-4 ${upvoted ? 'text-indigo-300' : ''}`} />
                    <span className="font-mono text-sm font-bold tabular-nums">{idea.upvoterIds.length}</span>
                    <span className="text-[9px] uppercase tracking-wide opacity-70">votes</span>
                  </button>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-sm font-semibold text-white">{idea.title}</h2>
                      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
                        {status.icon}
                        {status.label}
                      </span>
                      <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-slate-400">
                        {idea.category}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-300">{idea.description}</p>
                    {idea.adminResponse && (
                      <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200">
                        <span className="font-semibold">Staff response: </span>
                        {idea.adminResponse}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[10px] text-slate-500">
                      <span>by @{idea.author?.username || idea.authorName}</span>
                      <span>{new Date(idea.createdAt).toLocaleDateString()}</span>
                      {idea.status === 'SHIPPED' && <span className="text-emerald-400">Live on Snout</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
