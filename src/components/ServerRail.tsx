import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Bell,
  Bookmark,
  BookOpen,
  Bot,
  Compass,
  Crown,
  LifeBuoy,
  Plus,
  Rocket,
  ShieldAlert,
} from 'lucide-react';
import { useChordStore } from '../stores/useChordStore.ts';
import { SnoutBrandIcon } from './SnoutBrandIcon.tsx';

interface ServerRailProps {
  onOpenCreateServer: () => void;
  onOpenDiscovery: () => void;
  onToggleNotifications: () => void;
  onToggleBookmarks: () => void;
}

export const ServerRail: React.FC<ServerRailProps> = ({
  onOpenCreateServer,
  onOpenDiscovery,
  onToggleNotifications,
  onToggleBookmarks,
}) => {
  const {
    user,
    servers,
    directThreads,
    activeSection,
    activeServerId,
    notifications,
    bookmarks,
    unreadByTarget,
    setActiveSection,
    selectServer,
  } = useChordStore();

  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;
  const dmUnreadCount = directThreads.reduce(
    (sum, t) => sum + (unreadByTarget[t.id] || 0),
    0
  );

  return (
    <aside
      aria-label="Server navigation"
      className="flex h-full w-[72px] shrink-0 flex-col items-center justify-between border-r border-white/[0.06] bg-[#0D0F12] py-3 select-none"
    >
      <div className="flex flex-col items-center gap-2.5 overflow-y-auto no-scrollbar w-full px-2">
        {/* Home / DMs */}
        <div className="relative flex items-center justify-center w-full">
          {activeSection === 'home' && (
            <motion.span
              layoutId="rail-active-bar"
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="absolute -left-2 h-8 w-1 rounded-r-md bg-white"
            />
          )}
          <button
            type="button"
            title="Snout — Direct Messages & Friends"
            onClick={() => setActiveSection('home')}
            className={`group relative flex h-12 w-12 items-center justify-center overflow-hidden transition-all duration-150 ${
              activeSection === 'home'
                ? 'rounded-xl ring-2 ring-[#5865F2] shadow-lg shadow-[#5865F2]/25'
                : 'rounded-2xl bg-[#171A21] hover:rounded-xl hover:ring-2 hover:ring-[#5865F2]/60'
            }`}
          >
            <SnoutBrandIcon className="h-full w-full" alt="Snout Home" />
            {dmUnreadCount > 0 && (
              <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-md bg-rose-500 px-1 font-mono text-[10px] font-bold text-white ring-2 ring-[#0D0F12]">
                {dmUnreadCount > 9 ? '9+' : dmUnreadCount}
              </span>
            )}
          </button>
        </div>

        <div className="my-0.5 h-[1px] w-8 bg-white/10" />

        {/* Joined Servers */}
        {servers.map((server) => {
          const isActive = activeSection === 'server' && activeServerId === server.id;
          const initials = server.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          return (
            <div key={server.id} className="relative flex items-center justify-center w-full">
              {isActive && (
                <motion.span
                  layoutId="rail-active-bar"
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                  className="absolute -left-2 h-8 w-1 rounded-r-md bg-white"
                />
              )}
              <button
                type="button"
                title={server.name}
                onClick={() => void selectServer(server.id)}
                className={`group relative flex h-12 w-12 items-center justify-center overflow-hidden transition-all duration-150 ${
                  isActive
                    ? 'rounded-xl ring-2 ring-[#5865F2]'
                    : 'rounded-2xl bg-[#171A21] hover:rounded-xl hover:bg-[#262B36]'
                }`}
              >
                {server.iconUrl ? (
                  <ServerIcon iconUrl={server.iconUrl} name={server.name} initials={initials} />
                ) : (
                  <span className="font-display text-sm font-bold text-slate-200">{initials}</span>
                )}
              </button>
            </div>
          );
        })}

        {/* Create / Join Server */}
        <button
          type="button"
          title="Create or Join Server"
          onClick={onOpenCreateServer}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#171A21] text-emerald-400 transition-all hover:rounded-xl hover:bg-emerald-600 hover:text-white"
        >
          <Plus className="h-5 w-5" />
        </button>

        {/* Server Discovery */}
        <button
          type="button"
          title="Discover Public Servers"
          onClick={onOpenDiscovery}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#171A21] text-slate-300 transition-all hover:rounded-xl hover:bg-[#262B36] hover:text-white"
        >
          <Compass className="h-5 w-5" />
        </button>
      </div>

      {/* Bottom Utility Rail: Bookmarks, Notifications, Nitro, Developer Portal, Admin */}
      <div className="flex flex-col items-center gap-2 pt-2 border-t border-white/[0.06] w-full px-2">
        {user?.platformRole === 'ADMIN' && (
          <button
            type="button"
            title="Admin Dashboard"
            onClick={() => setActiveSection('admin')}
            className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
              activeSection === 'admin'
                ? 'bg-rose-600 text-white'
                : 'bg-[#171A21] text-rose-400 hover:bg-rose-500/20'
            }`}
          >
            <ShieldAlert className="h-4.5 w-4.5" />
          </button>
        )}

        <button
          type="button"
          title="Saved Bookmarks"
          onClick={onToggleBookmarks}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[#171A21] text-amber-300 hover:bg-[#262B36] hover:text-amber-200 transition-colors"
        >
          <Bookmark className="h-4.5 w-4.5" />
          {bookmarks.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-md bg-amber-500 px-1 font-mono text-[10px] font-bold text-slate-950 ring-2 ring-[#0D0F12]">
              {bookmarks.length > 9 ? '9+' : bookmarks.length}
            </span>
          )}
        </button>

        <button
          type="button"
          title="Notifications"
          onClick={onToggleNotifications}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[#171A21] text-slate-300 hover:bg-[#262B36] hover:text-white transition-colors"
        >
          <Bell className="h-4.5 w-4.5" />
          {unreadNotifCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-md bg-rose-500 px-1 font-mono text-[10px] font-bold text-white ring-2 ring-[#0D0F12]">
              {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
            </span>
          )}
        </button>

        <button
          type="button"
          title="Community Roadmap & Votes"
          onClick={() => setActiveSection('community')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
            activeSection === 'community'
              ? 'bg-indigo-500 text-white'
              : 'bg-[#171A21] text-indigo-300 hover:bg-indigo-500/20'
          }`}
        >
          <Rocket className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          title="Documentation"
          onClick={() => setActiveSection('docs')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
            activeSection === 'docs'
              ? 'bg-sky-600 text-white'
              : 'bg-[#171A21] text-sky-300 hover:bg-sky-500/20'
          }`}
        >
          <BookOpen className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          title="Support Centre"
          onClick={() => setActiveSection('support')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
            activeSection === 'support'
              ? 'bg-emerald-600 text-white'
              : 'bg-[#171A21] text-emerald-300 hover:bg-emerald-500/20'
          }`}
        >
          <LifeBuoy className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          title="SNOUT NITRO ($2.00/mo)"
          onClick={() => setActiveSection('nitro')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
            activeSection === 'nitro'
              ? 'bg-amber-400 text-slate-950'
              : 'bg-[#171A21] text-amber-400 hover:bg-amber-500/20'
          }`}
        >
          <Crown className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          title="Bot Developer Portal"
          onClick={() => setActiveSection('developer')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
            activeSection === 'developer'
              ? 'bg-[#5865F2] text-white'
              : 'bg-[#171A21] text-slate-300 hover:bg-[#262B36] hover:text-white'
          }`}
        >
          <Bot className="h-4.5 w-4.5" />
        </button>

      </div>
    </aside>
  );
};

const ServerIcon: React.FC<{ iconUrl: string; name: string; initials: string }> = ({ iconUrl, name, initials }) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === iconUrl) {
    return <span className="font-display text-sm font-bold text-slate-200">{initials}</span>;
  }
  return (
    <img
      src={iconUrl}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(iconUrl)}
      className="h-full w-full object-cover"
    />
  );
};
