import React, { useState } from 'react';
import { ArrowRight, Bookmark, Search, Trash2, X } from 'lucide-react';
import type { BookmarkItem } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

interface BookmarksDrawerProps {
  onClose: () => void;
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({ onClose }) => {
  const { bookmarks, refreshBookmarks, selectServer, selectThread, pushToast } = useChordStore();
  const [search, setSearch] = useState('');

  const filtered = bookmarks.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      b.content.toLowerCase().includes(q) ||
      b.authorName.toLowerCase().includes(q) ||
      b.channelName.toLowerCase().includes(q) ||
      b.note.toLowerCase().includes(q)
    );
  });

  const handleJump = async (bm: BookmarkItem) => {
    onClose();
    if (bm.serverId && bm.channelId) {
      await selectServer(bm.serverId, bm.channelId);
    } else if (bm.threadId) {
      await selectThread(bm.threadId);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await apiRequest(`/api/bookmarks/${id}`, { method: 'DELETE' });
      await refreshBookmarks();
      pushToast({ type: 'info', title: 'Bookmark removed' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Remove failed', description: (err as Error).message });
    }
  };

  return (
    <div className="fixed bottom-16 left-20 z-50 w-96 max-w-[calc(100vw-6rem)] rounded-2xl border border-white/10 bg-[#12151A] p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-amber-400" />
          <span className="font-display text-sm font-semibold text-white">
            Saved Bookmarks ({bookmarks.length})
          </span>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter saved messages..."
          className="w-full rounded-lg border border-white/10 bg-[#0D0F12] py-1.5 pl-8 pr-3 text-xs text-white focus:border-[#5865F2] focus:outline-none"
        />
      </div>

      <div className="max-h-80 overflow-y-auto space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            {bookmarks.length === 0
              ? 'Hover any message in chat and click Bookmark to save it here.'
              : 'No bookmarks matched your filter.'}
          </p>
        ) : (
          filtered.map((bm) => (
            <div
              key={bm.id}
              className="rounded-xl border border-white/[0.06] bg-[#171A21] p-3 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white truncate">{bm.authorName}</span>
                <span className="font-mono text-[10px] text-slate-400 truncate">{bm.channelName}</span>
              </div>
              <p className="text-slate-300 line-clamp-3">{bm.content}</p>
              {bm.note && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[11px] text-amber-200">
                  {bm.note}
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => void handleJump(bm)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:underline"
                >
                  <span>Jump to channel</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(bm.id)}
                  className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
