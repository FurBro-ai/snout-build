import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Bot,
  Calendar,
  Crown,
  Database,
  Hash,
  MessageSquare,
  Search,
  Server as ServerIcon,
  ShieldAlert,
  Users,
  Volume2,
} from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

interface SwitcherItem {
  id: string;
  label: string;
  subtitle: string;
  category: 'Navigation' | 'Channels' | 'Direct Messages' | 'Servers' | 'Friends' | 'Messages' | 'Database Rows';
  icon: React.ReactNode;
  onSelect: () => Promise<void> | void;
}

export const QuickSwitcherModal: React.FC = () => {
  const {
    user,
    servers,
    serverBundle,
    directThreads,
    friends,
    quickSwitcherOpen,
    setQuickSwitcherOpen,
    setActiveSection,
    setActiveServerView,
    selectServer,
    selectChannel,
    selectThread,
    refreshDms,
  } = useChordStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remoteMessages, setRemoteMessages] = useState<Array<{
    id: string;
    channelId: string | null;
    threadId: string | null;
    serverId: string | null;
    channelName: string;
    serverName: string | null;
    authorName: string;
    content: string;
  }>>([]);
  const [remoteDbRows, setRemoteDbRows] = useState<Array<{
    rowId: string;
    tableId: string;
    tableName: string;
    serverId: string;
    serverName: string;
    preview: string;
  }>>([]);

  useEffect(() => {
    if (quickSwitcherOpen) {
      setQuery('');
      setSelectedIndex(0);
      setRemoteMessages([]);
      setRemoteDbRows([]);
    }
  }, [quickSwitcherOpen]);

  useEffect(() => {
    if (!quickSwitcherOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteMessages([]);
      setRemoteDbRows([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiRequest<{
        messages: typeof remoteMessages;
        databaseRows: typeof remoteDbRows;
      }>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          setRemoteMessages(res.messages || []);
          setRemoteDbRows(res.databaseRows || []);
        })
        .catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [query, quickSwitcherOpen]);

  const items = useMemo<SwitcherItem[]>(() => {
    const list: SwitcherItem[] = [
      {
        id: 'nav-friends',
        label: 'Friends & Social Hub',
        subtitle: 'Manage friends, pending requests, and online presence',
        category: 'Navigation',
        icon: <Users className="h-4 w-4 text-slate-300" />,
        onSelect: () => {
          setActiveSection('home');
          useChordStore.setState({ activeThreadId: null });
        },
      },
      {
        id: 'nav-nitro',
        label: 'SNOUT NITRO — $2.00 / month',
        subtitle: 'Subscription billing, Platega checkout, and profile perks',
        category: 'Navigation',
        icon: <Crown className="h-4 w-4 text-amber-400" />,
        onSelect: () => setActiveSection('nitro'),
      },
      {
        id: 'nav-dev',
        label: 'Bot Developer Portal',
        subtitle: 'Create bots, rotate tokens, and configure slash commands',
        category: 'Navigation',
        icon: <Bot className="h-4 w-4 text-[#818CF8]" />,
        onSelect: () => setActiveSection('developer'),
      },
    ];

    if (user?.platformRole === 'ADMIN') {
      list.push({
        id: 'nav-admin',
        label: 'Platform Administration Console',
        subtitle: 'Users, servers, Platega transactions, and audit logs',
        category: 'Navigation',
        icon: <ShieldAlert className="h-4 w-4 text-rose-400" />,
        onSelect: () => setActiveSection('admin'),
      });
    }

    if (serverBundle) {
      list.push(
        {
          id: 'srv-view-databases',
          label: `${serverBundle.server.name} · Built-in Databases`,
          subtitle: 'Collaborative structured SQLite tables and records',
          category: 'Navigation',
          icon: <Database className="h-4 w-4 text-[#818CF8]" />,
          onSelect: () => {
            setActiveSection('server');
            setActiveServerView('databases');
          },
        },
        {
          id: 'srv-view-events',
          label: `${serverBundle.server.name} · Scheduled Events`,
          subtitle: 'Community hangouts and voice stage RSVPs',
          category: 'Navigation',
          icon: <Calendar className="h-4 w-4 text-emerald-400" />,
          onSelect: () => {
            setActiveSection('server');
            setActiveServerView('events');
          },
        }
      );
      for (const ch of serverBundle.channels) {
        list.push({
          id: `chan-${ch.id}`,
          label: `#${ch.name}`,
          subtitle: `${serverBundle.server.name} · ${ch.type} channel`,
          category: 'Channels',
          icon:
            ch.type === 'VOICE' ? (
              <Volume2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <Hash className="h-4 w-4 text-slate-400" />
            ),
          onSelect: () => selectChannel(ch.id),
        });
      }
    }

    for (const s of servers) {
      list.push({
        id: `srv-${s.id}`,
        label: s.name,
        subtitle: s.description || 'Server workspace',
        category: 'Servers',
        icon: <ServerIcon className="h-4 w-4 text-indigo-300" />,
        onSelect: () => selectServer(s.id),
      });
    }

    for (const thread of directThreads) {
      const others = thread.participants.filter((p) => p.id !== user?.id);
      const title = thread.isGroup
        ? thread.name || others.map((o) => o.displayName).join(', ')
        : others[0]?.displayName || 'Direct Message';
      list.push({
        id: `dm-${thread.id}`,
        label: title,
        subtitle: thread.isGroup ? `Group DM · ${thread.participants.length} members` : `@${others[0]?.username || 'dm'}`,
        category: 'Direct Messages',
        icon: <MessageSquare className="h-4 w-4 text-slate-300" />,
        onSelect: () => selectThread(thread.id),
      });
    }

    for (const f of friends) {
      list.push({
        id: `fr-${f.user.id}`,
        label: f.user.displayName,
        subtitle: `Open DM with @${f.user.username}`,
        category: 'Friends',
        icon: <MessageSquare className="h-4 w-4 text-emerald-400" />,
        onSelect: async () => {
          const res = await apiRequest<{ thread: { id: string } }>('/api/dms', {
            method: 'POST',
            body: JSON.stringify({ participantIds: [f.user.id] }),
          });
          await refreshDms();
          await selectThread(res.thread.id);
        },
      });
    }

    return list;
  }, [
    user,
    serverBundle,
    servers,
    directThreads,
    friends,
    setActiveSection,
    setActiveServerView,
    selectChannel,
    selectServer,
    selectThread,
    refreshDms,
  ]);

  const remoteItems = useMemo<SwitcherItem[]>(() => {
    const out: SwitcherItem[] = [];
    for (const r of remoteDbRows) {
      out.push({
        id: `rmrow-${r.rowId}`,
        label: r.preview,
        subtitle: `${r.serverName} · ${r.tableName}`,
        category: 'Database Rows',
        icon: <Database className="h-4 w-4 text-[#818CF8]" />,
        onSelect: async () => {
          await selectServer(r.serverId);
          setActiveServerView('databases');
        },
      });
    }
    for (const m of remoteMessages) {
      out.push({
        id: `rmmsg-${m.id}`,
        label: m.content,
        subtitle: `${m.authorName} in ${m.serverName ? `${m.serverName} ${m.channelName}` : m.channelName}`,
        category: 'Messages',
        icon: <MessageSquare className="h-4 w-4 text-slate-300" />,
        onSelect: async () => {
          if (m.serverId && m.channelId) {
            await selectServer(m.serverId, m.channelId);
          } else if (m.threadId) {
            await selectThread(m.threadId);
          }
        },
      });
    }
    return out;
  }, [remoteDbRows, remoteMessages, selectServer, selectThread, setActiveServerView]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    const local = items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
    return [...local, ...remoteItems].slice(0, 20);
  }, [items, remoteItems, query]);

  if (!quickSwitcherOpen) return null;

  const executeItem = async (item: SwitcherItem) => {
    setQuickSwitcherOpen(false);
    await item.onSelect();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuickSwitcherOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      void executeItem(filtered[selectedIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 pt-20 p-4 backdrop-blur-sm"
      onClick={() => setQuickSwitcherOpen(false)}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#12151A] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <Search className="h-4.5 w-4.5 text-[#818CF8] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Where would you like to go? Jump to servers, channels, DMs, Nitro..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-white/10 bg-[#0D0F12] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No matching servers, channels, or conversations found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => void executeItem(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active ? 'bg-[#5865F2] text-white' : 'text-slate-200 hover:bg-[#1E222B]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0D0F12]/60">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.label}</div>
                      <div
                        className={`truncate text-xs ${
                          active ? 'text-indigo-100' : 'text-slate-400'
                        }`}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-[10px] ${
                      active ? 'text-indigo-100' : 'text-slate-500'
                    }`}
                  >
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#0F1216] px-4 py-2 text-[11px] text-slate-500">
          <span>Use ↑ ↓ arrows to navigate · Enter to jump</span>
          <span className="font-mono">Ctrl/⌘ + K</span>
        </div>
      </motion.div>
    </div>
  );
};
