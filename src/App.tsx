import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BookmarksDrawer } from './components/BookmarksDrawer.tsx';
import { ChannelSettingsModal } from './components/ChannelSettingsModal.tsx';
import { ChannelSidebar } from './components/ChannelSidebar.tsx';
import { ChatArea } from './components/ChatArea.tsx';
import { FriendsView } from './components/FriendsView.tsx';
import { MemberList } from './components/MemberList.tsx';
import { QuickSwitcherModal } from './components/QuickSwitcherModal.tsx';
import { ServerEventsView } from './components/ServerEventsView.tsx';
import { ServerRail } from './components/ServerRail.tsx';
import { ServerSettingsModal } from './components/ServerSettingsModal.tsx';
import { ToastContainer } from './components/ToastContainer.tsx';
import { UserProfileModal } from './components/UserProfileModal.tsx';
import { UserSettingsModal } from './components/UserSettingsModal.tsx';
import { VoiceStageView } from './components/VoiceStageView.tsx';
import {
  CreateChannelModal,
  CreateOrJoinServerModal,
  DiscoveryModal,
  GroupDmModal,
  InviteModal,
} from './components/WorkspaceModals.tsx';
import { useWebRTC } from './hooks/useWebRTC.ts';
import './lib/firebase.ts';
import { AdminDashboardPage } from './pages/AdminDashboardPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { CommunityVotesPage } from './pages/CommunityVotesPage.tsx';
import { DeveloperPortalPage } from './pages/DeveloperPortalPage.tsx';
import { DocsPage } from './pages/DocsPage.tsx';
import { NitroPage } from './pages/NitroPage.tsx';
import { SupportPage } from './pages/SupportPage.tsx';
import { apiRequest } from './services/api.ts';
import { useChordStore } from './stores/useChordStore.ts';

export default function App() {
  const {
    user,
    authChecked,
    activeSection,
    activeServerView,
    serverBundle,
    activeChannelId,
    activeThreadId,
    directThreads,
    showMemberList,
    notifications,
    quickSwitcherOpen,
    bootstrapSession,
    setActiveSection,
    refreshNotifications,
    setQuickSwitcherOpen,
  } = useChordStore();

  const webrtc = useWebRTC();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupDm, setShowGroupDm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined | null>(null);

  useEffect(() => {
    void bootstrapSession();
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'nitro') {
      setActiveSection('nitro');
    }
  }, [bootstrapSession, setActiveSection]);

  // Global Ctrl+K / Cmd+K Quick Switcher shortcut
  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSwitcherOpen(!quickSwitcherOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user, quickSwitcherOpen, setQuickSwitcherOpen]);

  // Auto-collapse mobile navigation drawer on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeSection, activeChannelId, activeThreadId]);

  if (!authChecked) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0D0F12] text-sm text-slate-400">
        Initializing Snout workspace...
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  const activeChannel = serverBundle?.channels.find((c) => c.id === activeChannelId) || null;
  const activeThread = directThreads.find((t) => t.id === activeThreadId) || null;

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  };

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#0D0F12] text-[#F1F3F5]">
      {/* Mobile Sidebar Toggle */}
      <button
        type="button"
        aria-label="Toggle navigation"
        onClick={() => setMobileNavOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#5865F2] text-white shadow-lg md:hidden"
      >
        {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Left Rails (ServerRail + ChannelSidebar) */}
      <div
        className={`${
          mobileNavOpen ? 'fixed inset-y-0 left-0 z-30 flex' : 'hidden md:flex'
        } h-full shrink-0`}
      >
        <ServerRail
          onOpenCreateServer={() => setShowCreateServer(true)}
          onOpenDiscovery={() => setShowDiscovery(true)}
          onToggleNotifications={() => {
            setShowBookmarks(false);
            setShowNotifications((n) => !n);
          }}
          onToggleBookmarks={() => {
            setShowNotifications(false);
            setShowBookmarks((b) => !b);
          }}
        />
        {(activeSection === 'home' || activeSection === 'server') && (
          <ChannelSidebar
            webrtc={webrtc}
            onOpenUserSettings={() => setShowUserSettings(true)}
            onOpenServerSettings={() => setShowServerSettings(true)}
            onOpenInviteModal={() => setShowInvite(true)}
            onOpenCreateChannel={(catId) => setCreateChannelCategoryId(catId ?? '')}
            onOpenGroupDm={() => setShowGroupDm(true)}
          />
        )}
      </div>

      {/* Main Viewport */}
      <main className="flex flex-1 min-w-0 overflow-hidden">
        {activeSection === 'nitro' && <NitroPage />}
        {activeSection === 'developer' && <DeveloperPortalPage />}
        {activeSection === 'community' && <CommunityVotesPage />}
        {activeSection === 'docs' && <DocsPage />}
        {activeSection === 'support' && <SupportPage />}
        {activeSection === 'admin' && user.platformRole === 'ADMIN' && <AdminDashboardPage />}

        {activeSection === 'home' && (
          activeThread ? (
            <ChatArea thread={activeThread} webrtc={webrtc} />
          ) : (
            <FriendsView webrtc={webrtc} />
          )
        )}

        {activeSection === 'server' && (
          activeServerView === 'events' ? (
            <ServerEventsView />
          ) : activeChannel ? (
            activeChannel.type === 'VOICE' ? (
              <VoiceStageView channel={activeChannel} webrtc={webrtc} />
            ) : (
              <>
                <ChatArea channel={activeChannel} webrtc={webrtc} />
                {showMemberList && (
                  <div className="hidden lg:flex">
                    <MemberList />
                  </div>
                )}
              </>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center bg-[#171A21] text-sm text-slate-400">
              Select or create a channel to start communicating.
            </div>
          )
        )}
      </main>

      {/* Bookmarks Drawer */}
      {showBookmarks && <BookmarksDrawer onClose={() => setShowBookmarks(false)} />}

      {/* Notifications Drawer */}
      {showNotifications && (
        <div className="fixed bottom-16 left-20 z-50 w-80 rounded-2xl border border-white/10 bg-[#12151A] p-4 shadow-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="font-display text-sm font-semibold text-white">Notifications</span>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="text-xs text-indigo-300 hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">You are all caught up.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg border p-2.5 text-xs ${
                    n.isRead ? 'border-white/[0.04] bg-[#171A21]/50 text-slate-400' : 'border-[#5865F2]/30 bg-[#171A21] text-white'
                  }`}
                >
                  <div className="font-semibold">{n.title}</div>
                  <div className="mt-0.5 text-slate-400">{n.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modals & Overlays */}
      <QuickSwitcherModal />
      <UserProfileModal />
      <ChannelSettingsModal />
      <ToastContainer />

      {showUserSettings && <UserSettingsModal onClose={() => setShowUserSettings(false)} />}
      {showServerSettings && <ServerSettingsModal onClose={() => setShowServerSettings(false)} />}
      {showCreateServer && <CreateOrJoinServerModal onClose={() => setShowCreateServer(false)} />}
      {showDiscovery && <DiscoveryModal onClose={() => setShowDiscovery(false)} />}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showGroupDm && <GroupDmModal onClose={() => setShowGroupDm(false)} />}
      {createChannelCategoryId !== null && (
        <CreateChannelModal
          categoryId={createChannelCategoryId || undefined}
          onClose={() => setCreateChannelCategoryId(null)}
        />
      )}
    </div>
  );
}
