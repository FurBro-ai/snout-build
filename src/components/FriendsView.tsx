import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  MessageSquare,
  PhoneCall,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { PublicUser } from '../../shared/types.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { UserAvatar } from './UserAvatar.tsx';

type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

interface FriendsViewProps {
  webrtc?: ReturnType<typeof import('../hooks/useWebRTC.ts').useWebRTC>;
}

export const FriendsView: React.FC<FriendsViewProps> = ({ webrtc }) => {
  const {
    friends,
    incomingRequests,
    outgoingRequests,
    blockedUsers,
    refreshFriends,
    refreshDms,
    selectThread,
    setInspectedUser,
    pushToast,
  } = useChordStore();

  const [tab, setTab] = useState<FriendsTab>('online');
  const [filterQuery, setFilterQuery] = useState('');
  const [addTarget, setAddTarget] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const onlineFriends = friends.filter((f) => f.user.status !== 'offline');

  // Live directory search when typing in Add Friend tab
  useEffect(() => {
    if (tab !== 'add') return;
    const q = addTarget.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingUsers(true);
      void apiRequest<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(q)}`)
        .then((res) => setSearchResults(res.users))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchingUsers(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [addTarget, tab]);

  const sendRequestToTarget = async (target: string) => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ acceptedImmediately?: boolean }>('/api/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ target }),
      });
      setAddTarget('');
      setSearchResults([]);
      const text = res.acceptedImmediately
        ? 'Friend request matched an existing request — you are now friends.'
        : 'Friend request sent.';
      setFeedback({ type: 'ok', text });
      pushToast({ type: 'success', title: text });
      await refreshFriends();
    } catch (err) {
      const msg = (err as Error).message;
      setFeedback({ type: 'err', text: msg });
      pushToast({ type: 'error', title: 'Friend request failed', description: msg });
    }
  };

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTarget.trim()) return;
    await sendRequestToTarget(addTarget.trim());
  };

  const handleRespond = async (requestId: string, action: 'ACCEPT' | 'DECLINE') => {
    try {
      await apiRequest(`/api/friends/requests/${requestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await refreshFriends();
      pushToast({
        type: 'info',
        title: action === 'ACCEPT' ? 'Friend request accepted' : 'Friend request declined',
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Action failed', description: (err as Error).message });
    }
  };

  const handleRemoveFriend = async (friendUserId: string) => {
    try {
      await apiRequest(`/api/friends/${friendUserId}`, { method: 'DELETE' });
      await refreshFriends();
      pushToast({ type: 'info', title: 'Friend removed' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Remove failed', description: (err as Error).message });
    }
  };

  const handleBlock = async (targetUserId: string) => {
    try {
      await apiRequest(`/api/friends/block/${targetUserId}`, { method: 'POST' });
      await refreshFriends();
      pushToast({ type: 'info', title: 'User blocked' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Block failed', description: (err as Error).message });
    }
  };

  const handleUnblock = async (targetUserId: string) => {
    try {
      await apiRequest(`/api/friends/block/${targetUserId}`, { method: 'DELETE' });
      await refreshFriends();
      pushToast({ type: 'info', title: 'User unblocked' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Unblock failed', description: (err as Error).message });
    }
  };

  const handleOpenDm = async (friendUserId: string, startVoiceCall = false) => {
    try {
      const res = await apiRequest<{ thread: { id: string } }>('/api/dms', {
        method: 'POST',
        body: JSON.stringify({ participantIds: [friendUserId] }),
      });
      await refreshDms();
      await selectThread(res.thread.id);
      if (startVoiceCall && webrtc) {
        await webrtc.joinVoiceChannel(`dm-${res.thread.id}`, null);
      }
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not open conversation', description: (err as Error).message });
    }
  };

  const baseFriends = tab === 'online' ? onlineFriends : friends;
  const displayedFriends = baseFriends.filter((f) => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      f.user.displayName.toLowerCase().includes(q) ||
      f.user.username.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-1 flex-col bg-[#171A21] overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
        <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-white shrink-0">
            <Users className="h-4 w-4 text-slate-400" />
            <span>Friends</span>
          </div>
          <div className="h-4 w-[1px] bg-white/10 shrink-0" />
          <nav className="flex items-center gap-1.5 text-xs font-medium">
            {([
              ['online', `Online (${onlineFriends.length})`],
              ['all', `All (${friends.length})`],
              ['pending', `Pending (${incomingRequests.length + outgoingRequests.length})`],
              ['blocked', `Blocked (${blockedUsers.length})`],
            ] as Array<[FriendsTab, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg px-2.5 py-1.5 whitespace-nowrap transition-colors ${
                  tab === key
                    ? 'bg-[#262B36] text-white'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTab('add')}
              className={`rounded-lg px-3 py-1.5 whitespace-nowrap font-semibold transition-colors ${
                tab === 'add'
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              Add Friend
            </button>
          </nav>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full">
        {tab === 'add' && (
          <div className="space-y-5">
            <div>
              <h3 className="font-display text-lg font-bold text-white">Add Friend</h3>
              <p className="text-sm text-slate-400">
                Search by username or display name, or paste an exact Snout User ID to send a real-time friend request.
              </p>
            </div>

            <form onSubmit={handleSendRequest} className="flex gap-2">
              <input
                type="text"
                required
                value={addTarget}
                onChange={(e) => setAddTarget(e.target.value)}
                placeholder="Search username or enter User ID..."
                className="flex-1 rounded-xl border border-white/10 bg-[#12151A] px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-[#5865F2] focus:outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-2 rounded-xl bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4752C4]"
              >
                <UserPlus className="h-4 w-4" />
                <span>Send Request</span>
              </button>
            </form>

            {feedback && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  feedback.type === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                {feedback.text}
              </div>
            )}

            {addTarget.trim().length >= 2 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-400">
                  {searchingUsers ? 'Searching Snout directory...' : `Matching Users (${searchResults.length})`}
                </div>
                {searchResults.map((u) => {
                  const alreadyFriend = friends.some((f) => f.user.id === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#12151A] px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <UserAvatar user={u} size="md" showStatus onClick={() => setInspectedUser(u)} />
                        <div>
                          <div className="text-sm font-semibold text-white">{u.displayName}</div>
                          <div className="font-mono text-xs text-slate-400">@{u.username}</div>
                        </div>
                      </div>
                      {alreadyFriend ? (
                        <button
                          type="button"
                          onClick={() => void handleOpenDm(u.id)}
                          className="rounded-lg bg-[#1E222B] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#262B36]"
                        >
                          Message
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void sendRequestToTarget(u.username)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>Add</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(tab === 'online' || tab === 'all') && (
          <div className="space-y-3">
            {baseFriends.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter friends by name or @username..."
                  className="w-full rounded-xl border border-white/10 bg-[#12151A] py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-[#5865F2] focus:outline-none"
                />
              </div>
            )}

            {displayedFriends.length === 0 ? (
              <div className="flex min-h-[min(58vh,460px)] items-center justify-center px-4 py-8">
                <div className="w-full max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#12151A] text-slate-300">
                    {tab === 'online' && friends.length > 0 ? <Users className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="font-display text-base font-semibold text-white">
                      {filterQuery
                        ? 'No matching friends'
                        : tab === 'online' && friends.length > 0
                        ? 'Everyone is offline'
                        : 'Your friend list is empty'}
                    </h2>
                    <p className="text-sm leading-6 text-slate-400">
                      {filterQuery
                        ? 'Try another name or username, or clear your filter.'
                        : tab === 'online' && friends.length > 0
                        ? 'Your friends are still in your list. Check everyone or start a new connection.'
                        : 'Find someone by username or display name to start a conversation.'}
                    </p>
                  </div>
                  {filterQuery ? (
                    <button
                      type="button"
                      onClick={() => setFilterQuery('')}
                      className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.05]"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear filter
                    </button>
                  ) : tab === 'online' && friends.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setTab('all')}
                      className="inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
                    >
                      <Users className="h-3.5 w-3.5" />
                      View all friends
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTab('add')}
                      className="inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add a Friend
                    </button>
                  )}
                </div>
              </div>
            ) : (
              displayedFriends.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#12151A] px-4 py-3 hover:border-white/15 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      user={f.user}
                      size="md"
                      showStatus
                      onClick={() => setInspectedUser(f.user)}
                    />
                    <div>
                      <button
                        type="button"
                        onClick={() => setInspectedUser(f.user)}
                        className="text-sm font-semibold text-white hover:underline text-left"
                      >
                        {f.user.displayName}
                      </button>
                      <div className="text-xs text-slate-400">
                        @{f.user.username} · {f.user.customStatus || f.user.status}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      title="Send Direct Message"
                      onClick={() => void handleOpenDm(f.user.id, false)}
                      className="rounded-lg bg-[#1E222B] p-2 text-slate-200 hover:bg-[#5865F2] hover:text-white"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                    {webrtc && (
                      <button
                        type="button"
                        title="Start Voice Call"
                        onClick={() => void handleOpenDm(f.user.id, true)}
                        className="rounded-lg bg-[#1E222B] p-2 text-emerald-400 hover:bg-emerald-600 hover:text-white"
                      >
                        <PhoneCall className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Remove Friend"
                      onClick={() => void handleRemoveFriend(f.user.id)}
                      className="rounded-lg bg-[#1E222B] p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Block User"
                      onClick={() => void handleBlock(f.user.id)}
                      className="rounded-lg bg-[#1E222B] p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'pending' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400">
                Incoming Requests ({incomingRequests.length})
              </h4>
              {incomingRequests.length === 0 ? (
                <p className="text-sm text-slate-500">No incoming friend requests.</p>
              ) : (
                incomingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#12151A] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        user={req.sender}
                        size="md"
                        onClick={req.sender ? () => setInspectedUser(req.sender!) : undefined}
                      />
                      <div>
                        <div className="text-sm font-semibold text-white">{req.sender?.displayName}</div>
                        <div className="text-xs text-slate-400">@{req.sender?.username}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRespond(req.id, 'ACCEPT')}
                        className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-500"
                        title="Accept"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRespond(req.id, 'DECLINE')}
                        className="rounded-lg bg-[#1E222B] p-2 text-slate-300 hover:bg-rose-500/20 hover:text-rose-300"
                        title="Decline"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400">
                Outgoing Requests ({outgoingRequests.length})
              </h4>
              {outgoingRequests.length === 0 ? (
                <p className="text-sm text-slate-500">No outgoing friend requests.</p>
              ) : (
                outgoingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#12151A] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar user={req.receiver} size="md" />
                      <div>
                        <div className="text-sm font-semibold text-white">{req.receiver?.displayName}</div>
                        <div className="text-xs text-slate-400">Pending acceptance</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'blocked' && (
          <div className="space-y-2">
            {blockedUsers.length === 0 ? (
              <p className="text-sm text-slate-500">No blocked users.</p>
            ) : (
              blockedUsers.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#12151A] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar user={b.user} size="md" />
                    <div>
                      <div className="text-sm font-semibold text-white">{b.user.displayName}</div>
                      <div className="text-xs text-slate-400">@{b.user.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleUnblock(b.user.id)}
                    className="rounded-lg bg-[#1E222B] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/15"
                  >
                    Unblock
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
