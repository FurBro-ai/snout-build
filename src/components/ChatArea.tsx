import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2,
  Bold,
  Bookmark,
  Check,
  CheckCheck,
  Code,
  Crown,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Hash,
  Italic,
  Megaphone,
  MessageSquareText,
  Mic,
  Paperclip,
  PhoneCall,
  Pin,
  Plus,
  Quote,
  Reply,
  Search,
  Send,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { NITRO_EMOJIS, PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import type { Channel, DirectThread, Message, MessageAttachment, PublicUser } from '../../shared/types.ts';
import { apiRequest, uploadFileToServer } from '../services/api.ts';
import { getChordSocket } from '../services/socket.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';
import { UserAvatar } from './UserAvatar.tsx';

interface ChatAreaProps {
  channel?: Channel | null;
  thread?: DirectThread | null;
  webrtc: ReturnType<typeof import('../hooks/useWebRTC.ts').useWebRTC>;
}

const STANDARD_EMOJIS = ['👍', '❤️', '😂', '🔥', '🚀', '👀', '🎉', '💯', '✨', '👏'];

const STUDIO_STICKERS = [
  { id: 'approved', token: '[sticker:approved]', label: 'Approved', accent: '#10B981', subtitle: 'VERIFIED' },
  { id: 'shipit', token: '[sticker:shipit]', label: 'Ship It', accent: '#5865F2', subtitle: 'DEPLOY' },
  { id: 'applause', token: '[sticker:applause]', label: 'Bravo', accent: '#F59E0B', subtitle: 'STUDIO' },
  { id: 'sync', token: '[sticker:sync]', label: 'In Sync', accent: '#38BDF8', subtitle: 'LIVE' },
] as const;

function renderStudioSticker(token: string) {
  const found = STUDIO_STICKERS.find((s) => s.token === token.trim());
  if (!found) return null;
  return (
    <div
      className="my-1 inline-flex items-center gap-3 rounded-xl border border-white/10 bg-[#12151A] px-3.5 py-2.5 shadow-sm"
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <rect x="2" y="2" width="32" height="32" rx="9" fill={found.accent} fillOpacity="0.18" stroke={found.accent} strokeWidth="1.5" />
        <path
          d="M11 18.5L15.5 23L25 13"
          fill="none"
          stroke={found.accent}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <div className="font-mono text-[10px] font-semibold tracking-wider" style={{ color: found.accent }}>
          {found.subtitle}
        </div>
        <div className="font-display text-sm font-bold text-white">{found.label}</div>
      </div>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const ChatArea: React.FC<ChatAreaProps> = ({ channel, thread, webrtc }) => {
  const {
    user,
    serverBundle,
    serverBots,
    messagesByTarget,
    typingByTarget,
    showMemberList,
    toggleMemberList,
    loadMessages,
    upsertMessage,
    removeMessage,
    refreshBookmarks,
    setInspectedUser,
    pushToast,
  } = useChordStore();

  const targetType = channel ? 'channel' : 'thread';
  const targetId = channel ? channel.id : thread?.id || '';
  const messages = messagesByTarget[targetId] || [];
  const typingUsers = typingByTarget[targetId] || [];

  const [draft, setDraft] = useState('');
  const [forumTitle, setForumTitle] = useState('');
  const [showForumComposer, setShowForumComposer] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  const [showPinned, setShowPinned] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPollBuilder, setShowPollBuilder] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [showReadNames, setShowReadNames] = useState(false);
  const [reactTargetId, setReactTargetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; filename: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReadSentRef = useRef<string | null>(null);

  useEffect(() => {
    setSearchQuery('');
    setActiveSearchTerm('');
    setShowPinned(false);
    setShowPollBuilder(false);
    setShowReadNames(false);
    setReplyTo(null);
    setEditingMsgId(null);
    lastReadSentRef.current = null;
  }, [targetId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, targetId]);

  // Mark latest message from another user as read in real time
  useEffect(() => {
    if (!targetId || !user || messages.length === 0) return;
    const latestOther = [...messages].reverse().find((m) => m.authorId !== user.id);
    if (
      latestOther &&
      !latestOther.readByIds.includes(user.id) &&
      lastReadSentRef.current !== latestOther.id
    ) {
      lastReadSentRef.current = latestOther.id;
      void apiRequest(`/api/messages/${latestOther.id}/read`, { method: 'POST' }).catch(() => {});
    }
  }, [messages, targetId, user]);

  const canSend = channel && serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.SEND_MESSAGES)
    : true;
  const canManageMessages = channel && serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_MESSAGES)
    : false;
  const canPin = channel && serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.PIN_MESSAGES)
    : true;

  const pinnedMessages = messages.filter((m) => m.isPinned);

  const headerTitle = channel
    ? channel.name
    : thread?.isGroup
    ? thread.name || thread.participants.filter((p) => p.id !== user?.id).map((p) => p.displayName).join(', ')
    : thread?.participants.find((p) => p.id !== user?.id)?.displayName || 'Direct Message';

  // Dynamic slash command hints from installed server bots
  const slashHints = useMemo(() => {
    if (!draft.startsWith('/') || !channel) return [];
    const token = draft.split(' ')[0].toLowerCase().slice(1);
    const botCmds = serverBots.flatMap((b) =>
      b.slashCommands.map((c) => ({
        cmd: `/${c.name}`,
        desc: `${c.description} · ${b.name}`,
      }))
    );
    const defaults = [
      { cmd: '/help', desc: 'Show Snout Sentinel commands' },
      { cmd: '/ping', desc: 'Verify live WebSocket latency' },
      { cmd: '/serverinfo', desc: 'Display server stats' },
      { cmd: '/poll ', desc: 'Create a quick reaction poll' },
    ];
    const merged = botCmds.length > 0 ? botCmds : defaults;
    return merged.filter((h) => h.cmd.slice(1).toLowerCase().startsWith(token));
  }, [draft, channel, serverBots]);

  // Dynamic @mention autocomplete
  const mentionHints = useMemo(() => {
    const match = draft.match(/(?:^|\s)@([a-zA-Z0-9_.\-]*)$/);
    if (!match) return [];
    const q = match[1].toLowerCase();
    const candidates: PublicUser[] = channel && serverBundle
      ? serverBundle.members.map((m) => m.user).filter((u): u is PublicUser => Boolean(u))
      : thread
      ? thread.participants
      : [];
    return candidates
      .filter(
        (u) =>
          u.id !== user?.id &&
          (u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [draft, channel, serverBundle, thread, user?.id]);

  const emitTyping = (isTyping: boolean) => {
    const sock = getChordSocket();
    if (!sock || !targetId) return;
    sock.emit(
      isTyping ? 'typing:start' : 'typing:stop',
      channel ? { channelId: channel.id } : { threadId: thread?.id }
    );
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    emitTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1800);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!targetId || (!draft.trim() && pendingAttachments.length === 0)) return;
    setUploadError(null);
    emitTyping(false);

    const endpoint =
      targetType === 'channel'
        ? `/api/channels/${targetId}/messages`
        : `/api/dms/${targetId}/messages`;

    try {
      const res = await apiRequest<{ message: Message }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          content: draft.trim(),
          replyToId: replyTo?.id || null,
          attachments: pendingAttachments,
          forumTitle: channel?.type === 'FORUM' && forumTitle.trim() ? forumTitle.trim() : undefined,
        }),
      });
      upsertMessage(targetId, res.message);
      setDraft('');
      setForumTitle('');
      setShowForumComposer(false);
      setReplyTo(null);
      setPendingAttachments([]);
    } catch (err) {
      setUploadError((err as Error).message);
    }
  };

  const uploadSingleFile = async (file: File) => {
    setUploadError(null);
    try {
      const res = await uploadFileToServer(file, file.name);
      setPendingAttachments((prev) => [...prev, res.attachment]);
      pushToast({ type: 'success', title: 'Attachment ready', description: file.name });
    } catch (err) {
      setUploadError((err as Error).message);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadSingleFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (!canSend) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files.slice(0, 4)) {
      await uploadSingleFile(file);
    }
  };

  const toggleVoiceMessageRecord = async () => {
    if (recordingVoice && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingVoice(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const dur = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        try {
          const res = await uploadFileToServer(blob, `voice-${Date.now()}.webm`, {
            isVoiceMessage: true,
            durationSec: dur,
          });
          setPendingAttachments((prev) => [...prev, res.attachment]);
        } catch (err) {
          setUploadError((err as Error).message);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecordingSec(0);
      setRecordingVoice(true);
      recordTimerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    } catch {
      setUploadError('Microphone permission is required to record voice messages.');
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    try {
      const res = await apiRequest<{ message: Message }>(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      upsertMessage(targetId, res.message);
      setReactTargetId(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Reaction failed', description: (err as Error).message });
    }
  };

  const handleSaveEdit = async (messageId: string) => {
    if (!editingText.trim()) return;
    try {
      const res = await apiRequest<{ message: Message }>(`/api/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: editingText.trim() }),
      });
      upsertMessage(targetId, res.message);
      setEditingMsgId(null);
    } catch (err) {
      pushToast({ type: 'error', title: 'Edit failed', description: (err as Error).message });
    }
  };

  const handleDelete = async (messageId: string) => {
    try {
      await apiRequest(`/api/messages/${messageId}`, { method: 'DELETE' });
      removeMessage(targetId, messageId);
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  const handlePin = async (messageId: string) => {
    try {
      const res = await apiRequest<{ message: Message }>(`/api/messages/${messageId}/pin`, {
        method: 'POST',
      });
      upsertMessage(targetId, res.message);
      pushToast({ type: 'info', title: res.message.isPinned ? 'Message pinned' : 'Message unpinned' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Pin failed', description: (err as Error).message });
    }
  };

  const handleBookmark = async (messageId: string) => {
    try {
      await apiRequest('/api/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ messageId }),
      });
      await refreshBookmarks();
      pushToast({ type: 'success', title: 'Message saved to bookmarks' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Bookmark failed', description: (err as Error).message });
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;
    setActiveSearchTerm(searchQuery.trim());
    void loadMessages(targetType, targetId, searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setActiveSearchTerm('');
    if (targetId) void loadMessages(targetType, targetId);
  };

  const handleSelectMention = (username: string) => {
    setDraft((prev) => prev.replace(/(^|\s)@([a-zA-Z0-9_.\-]*)$/, `$1@${username} `));
    composerInputRef.current?.focus();
  };

  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(messageId);
    setTimeout(() => {
      setHighlightedMsgId((cur) => (cur === messageId ? null : cur));
    }, 1800);
  };

  const wrapDraftFormat = (prefix: string, suffix = prefix) => {
    const input = composerInputRef.current;
    if (!input) {
      setDraft((d) => `${d}${prefix}text${suffix}`);
      return;
    }
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end) || 'text';
    const next = `${draft.slice(0, start)}${prefix}${selected}${suffix}${draft.slice(end)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  };

  const handlePublishPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || !pollQuestion.trim()) return;
    const cleanOpts = pollOptions.map((o) => o.trim()).filter(Boolean).slice(0, 4);
    if (cleanOpts.length < 2) {
      pushToast({ type: 'error', title: 'Add at least 2 poll options' });
      return;
    }
    const badges = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
    const lines = [
      `**Poll: ${pollQuestion.trim()}**`,
      ...cleanOpts.map((opt, idx) => `${badges[idx]} ${opt}`),
      '',
      '_Click a number reaction below to cast your vote._',
    ];
    const endpoint =
      targetType === 'channel'
        ? `/api/channels/${targetId}/messages`
        : `/api/dms/${targetId}/messages`;
    try {
      const res = await apiRequest<{ message: Message }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ content: lines.join('\n') }),
      });
      upsertMessage(targetId, res.message);
      setShowPollBuilder(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      for (let i = 0; i < cleanOpts.length; i++) {
        await apiRequest(`/api/messages/${res.message.id}/reactions`, {
          method: 'POST',
          body: JSON.stringify({ emoji: badges[i] }),
        }).catch(() => {});
      }
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not publish poll', description: (err as Error).message });
    }
  };

  const resolveReaderNames = (readByIds: string[]) => {
    const others = readByIds.filter((id) => id !== user?.id);
    return others.map((id) => {
      const fromServer = serverBundle?.members.find((m) => m.userId === id)?.user?.displayName;
      const fromThread = thread?.participants.find((p) => p.id === id)?.displayName;
      return fromServer || fromThread || `User ${id.slice(0, 6)}`;
    });
  };

  const latestOwnMsgId = useMemo(() => {
    const own = [...messages].reverse().find((m) => m.authorId === user?.id);
    return own?.id || null;
  }, [messages, user?.id]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (canSend) setIsDraggingFile(true);
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={(e) => void handleDrop(e)}
      className="relative flex flex-1 flex-col bg-[#171A21] overflow-hidden"
    >
      {/* Drag-and-drop Upload Overlay */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0D0F12]/85 backdrop-blur-sm border-2 border-dashed border-[#5865F2] m-3 rounded-2xl">
          <Upload className="h-10 w-10 text-[#818CF8] mb-2" />
          <div className="font-display text-lg font-bold text-white">
            Drop files to attach to #{headerTitle}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Limit: {user?.isNitro ? '100 MB (SNOUT NITRO)' : '10 MB Standard'}
          </div>
        </div>
      )}

      {/* Top Channel / DM Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {channel?.type === 'ANNOUNCEMENT' ? (
            <Megaphone className="h-4.5 w-4.5 text-amber-400 shrink-0" />
          ) : channel?.type === 'FORUM' ? (
            <MessageSquareText className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
          ) : (
            <Hash className="h-4.5 w-4.5 text-slate-400 shrink-0" />
          )}
          <h2 className="truncate font-display text-sm font-semibold text-white">{headerTitle}</h2>
          {channel?.topic && (
            <span className="hidden md:inline truncate text-xs text-slate-400 border-l border-white/10 pl-2.5">
              {channel.topic}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {channel?.type === 'FORUM' && canSend && (
            <button
              type="button"
              onClick={() => setShowForumComposer((s) => !s)}
              className="rounded-lg bg-[#5865F2] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#4752C4]"
            >
              {showForumComposer ? 'Hide Post Title' : 'New Post'}
            </button>
          )}

          {thread && (
            <button
              type="button"
              title="Start Voice Call"
              onClick={() => void webrtc.joinVoiceChannel(`dm-${thread.id}`, null)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/[0.06] hover:text-white"
            >
              <PhoneCall className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            title="Pinned Messages"
            onClick={() => setShowPinned((p) => !p)}
            className={`relative rounded-lg p-1.5 transition-colors ${
              showPinned ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <Pin className="h-4 w-4" />
            {pinnedMessages.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </button>

          <form onSubmit={handleSearch} className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages"
              className="w-40 rounded-lg border border-white/10 bg-[#0D0F12] py-1 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:w-52 focus:border-[#5865F2] focus:outline-none transition-all"
            />
            {(searchQuery || activeSearchTerm) && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={handleClearSearch}
                className="absolute right-2 top-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </form>

          {channel && (
            <button
              type="button"
              title="Toggle Member List"
              onClick={toggleMemberList}
              className={`rounded-lg p-1.5 transition-colors ${
                showMemberList ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <Users className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Active Search Banner */}
      {activeSearchTerm && (
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#12151A] px-4 py-2 text-xs">
          <span className="text-slate-300">
            Showing <strong className="text-white">{messages.length}</strong> result(s) for{' '}
            <code className="font-mono text-indigo-300">"{activeSearchTerm}"</code>
          </span>
          <button
            type="button"
            onClick={handleClearSearch}
            className="text-indigo-300 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Pinned Messages Drawer */}
      {showPinned && (
        <div className="border-b border-white/[0.08] bg-[#12151A] px-5 py-3 max-h-56 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Pinned Messages ({pinnedMessages.length})</span>
            <button type="button" onClick={() => setShowPinned(false)} className="text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          {pinnedMessages.length === 0 ? (
            <p className="text-xs text-slate-500">No pinned messages in this channel yet.</p>
          ) : (
            pinnedMessages.map((pm) => (
              <div key={pm.id} className="rounded-lg border border-white/[0.06] bg-[#171A21] p-2.5 text-xs">
                <div className="font-semibold text-white mb-1">{pm.author?.displayName}</div>
                <div className="text-slate-300">{pm.content}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center max-w-md mx-auto space-y-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1E222B] text-slate-300">
              <Hash className="h-6 w-6" />
            </div>
            <h3 className="font-display text-lg font-bold text-white">Welcome to #{headerTitle}</h3>
            <p className="text-sm text-slate-400">
              {activeSearchTerm
                ? 'No messages matched your search query.'
                : 'This is the start of the conversation. Drag & drop files, use Markdown, or type /help.'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {messages.map((msg, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const currentDay = formatDayLabel(msg.createdAt);
              const prevDay = prev ? formatDayLabel(prev.createdAt) : null;
              const showDayDivider = currentDay !== prevDay;

              const timeDiffMs = prev
                ? new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()
                : Infinity;
              const isGrouped =
                !showDayDivider &&
                Boolean(prev) &&
                prev!.authorId === msg.authorId &&
                timeDiffMs < 5 * 60 * 1000 &&
                !msg.replyToMessage &&
                !msg.isForumPost &&
                channel?.type !== 'FORUM';

              const isAuthor = msg.authorId === user?.id;
              const timeLabel = new Date(msg.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const stickerCard = renderStudioSticker(msg.content);
              const seenByOthers =
                isAuthor &&
                msg.id === latestOwnMsgId &&
                msg.readByIds.some((id) => id !== user?.id);

              return (
                <React.Fragment key={msg.id}>
                  {showDayDivider && (
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-[1px] flex-1 bg-white/[0.07]" />
                      <span className="font-mono text-[11px] font-medium text-slate-500">
                        {currentDay}
                      </span>
                      <div className="h-[1px] flex-1 bg-white/[0.07]" />
                    </div>
                  )}

                  <div
                    id={`msg-${msg.id}`}
                    className={`group relative flex items-start gap-3.5 rounded-lg px-2 transition-colors hover:bg-white/[0.025] ${
                      highlightedMsgId === msg.id ? 'bg-[#5865F2]/20 ring-1 ring-[#5865F2]/60' : ''
                    } ${
                      msg.isForumPost
                        ? 'my-3 border border-white/[0.08] bg-[#12151A] p-4'
                        : isGrouped
                        ? 'py-0.5'
                        : 'mt-3 py-1'
                    }`}
                  >
                    {isGrouped ? (
                      <span className="w-10 shrink-0 pt-1 text-right font-mono text-[10px] text-transparent group-hover:text-slate-500 tabular-nums select-none">
                        {timeLabel}
                      </span>
                    ) : (
                      <UserAvatar
                        user={msg.author}
                        size="md"
                        onClick={msg.author ? () => setInspectedUser(msg.author!) : undefined}
                      />
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      {msg.replyToMessage && (
                        <button
                          type="button"
                          onClick={() => jumpToMessage(msg.replyToMessage!.id)}
                          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors text-left"
                        >
                          <Reply className="h-3 w-3 rotate-180 text-slate-500" />
                          <span className="font-medium text-slate-300">{msg.replyToMessage.authorName}</span>
                          <span className="truncate max-w-xs">{msg.replyToMessage.content}</span>
                        </button>
                      )}

                      {msg.isForumPost && msg.forumTitle && (
                        <div className="font-display text-base font-bold text-indigo-300">
                          {msg.forumTitle}
                        </div>
                      )}

                      {!isGrouped && (
                        <div className="flex items-baseline gap-2">
                          <button
                            type="button"
                            onClick={() => msg.author && setInspectedUser(msg.author)}
                            className="font-semibold text-sm text-white flex items-center gap-1 hover:underline text-left"
                          >
                            <span>{msg.author?.displayName || 'Unknown'}</span>
                            {msg.author?.isBot && (
                              <span className="rounded bg-[#5865F2] px-1 py-0.5 font-mono text-[9px] font-semibold text-white">
                                BOT
                              </span>
                            )}
                            {msg.author?.isNitro && !msg.author?.isBot && (
                              <Crown className="h-3 w-3 text-amber-400" />
                            )}
                          </button>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">{timeLabel}</span>
                          {msg.isEdited && <span className="text-[11px] text-slate-500">(edited)</span>}
                          {msg.isPinned && <Pin className="h-3 w-3 text-amber-400" />}
                        </div>
                      )}

                      {editingMsgId === msg.id ? (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            autoFocus
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveEdit(msg.id);
                              if (e.key === 'Escape') setEditingMsgId(null);
                            }}
                            className="flex-1 rounded-lg border border-white/15 bg-[#0D0F12] px-3 py-1.5 text-sm text-white focus:border-[#5865F2] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(msg.id)}
                            className="rounded-lg bg-[#5865F2] p-1.5 text-white"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(null)}
                            className="rounded-lg bg-white/10 p-1.5 text-slate-300"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : stickerCard ? (
                        stickerCard
                      ) : (
                        msg.content && <MarkdownRenderer content={msg.content} />
                      )}

                      {/* Attachments */}
                      {msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2.5 pt-1">
                          {msg.attachments.map((att) => {
                            if (att.isVoiceMessage || att.mimeType.startsWith('audio/')) {
                              return (
                                <div
                                  key={att.id}
                                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#12151A] px-3 py-2"
                                >
                                  <Mic className="h-4 w-4 text-[#5865F2]" />
                                  <audio controls src={att.url} className="h-8 max-w-[240px]" />
                                  {att.durationSec && (
                                    <span className="font-mono text-xs text-slate-400">{att.durationSec}s</span>
                                  )}
                                </div>
                              );
                            }
                            if (att.mimeType.startsWith('image/')) {
                              return (
                                <button
                                  key={att.id}
                                  type="button"
                                  onClick={() => setLightboxImage({ url: att.url, filename: att.filename })}
                                  className="block text-left focus:outline-none"
                                >
                                  <img
                                    src={att.url}
                                    alt={att.filename}
                                    referrerPolicy="no-referrer"
                                    className="max-h-64 max-w-sm rounded-xl border border-white/10 object-cover hover:border-[#5865F2] transition-colors"
                                  />
                                </button>
                              );
                            }
                            return (
                              <a
                                key={att.id}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#12151A] px-3.5 py-2.5 text-xs text-slate-200 hover:border-[#5865F2]"
                              >
                                <FileText className="h-4 w-4 text-[#5865F2]" />
                                <span className="font-medium">{att.filename}</span>
                                <span className="font-mono text-slate-400">
                                  {(att.sizeBytes / 1024).toFixed(1)} KB
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      )}

                      {/* Link Preview */}
                      {msg.linkPreview && (
                        <a
                          href={msg.linkPreview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 flex max-w-md items-start justify-between gap-3 rounded-xl border border-white/10 bg-[#12151A] p-3 hover:border-white/20 transition-colors"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="font-mono text-[11px] text-slate-400">{msg.linkPreview.domain}</div>
                            <div className="truncate text-sm font-semibold text-indigo-300">
                              {msg.linkPreview.title}
                            </div>
                            <div className="line-clamp-2 text-xs text-slate-400">
                              {msg.linkPreview.description}
                            </div>
                          </div>
                          <ExternalLink className="h-4 w-4 shrink-0 text-slate-500" />
                        </a>
                      )}

                      {/* Reactions */}
                      {msg.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {msg.reactions.map((r) => {
                            const reacted = user ? r.userIds.includes(user.id) : false;
                            return (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() => void handleReaction(msg.id, r.emoji)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                                  reacted
                                    ? 'border-[#5865F2] bg-[#5865F2]/20 text-white'
                                    : 'border-white/10 bg-[#12151A] text-slate-300 hover:border-white/20'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className="font-mono text-[11px] tabular-nums">{r.userIds.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Read receipt on latest own message */}
                      {seenByOthers && (
                        <div className="flex items-center gap-2 pt-0.5 font-mono text-[10px] text-slate-500">
                          <button
                            type="button"
                            onClick={() => setShowReadNames((v) => !v)}
                            className="inline-flex items-center gap-1 hover:text-slate-300"
                          >
                            <CheckCheck className="h-3 w-3 text-[#818CF8]" />
                            <span>
                              {showReadNames
                                ? `Seen by ${resolveReaderNames(msg.readByIds).join(', ')}`
                                : `Seen by ${msg.readByIds.filter((id) => id !== user?.id).length}`}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Hover Message Actions */}
                    <div className="absolute right-2 -top-3 hidden group-hover:flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#12151A] p-1 shadow-lg">
                      <button
                        type="button"
                        title="Add Reaction"
                        onClick={() => setReactTargetId(reactTargetId === msg.id ? null : msg.id)}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                      >
                        <Smile className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => {
                          setReplyTo(msg);
                          composerInputRef.current?.focus();
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Save Bookmark"
                        onClick={() => void handleBookmark(msg.id)}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-amber-300"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                      </button>
                      {canPin && (
                        <button
                          type="button"
                          title={msg.isPinned ? 'Unpin' : 'Pin'}
                          onClick={() => void handlePin(msg.id)}
                          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-amber-300"
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isAuthor && (
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => {
                            setEditingMsgId(msg.id);
                            setEditingText(msg.content);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(isAuthor || canManageMessages) && (
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => void handleDelete(msg.id)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {reactTargetId === msg.id && (
                      <div className="absolute right-2 top-6 z-30 flex gap-1 rounded-lg border border-white/10 bg-[#12151A] p-1.5 shadow-xl">
                        {STANDARD_EMOJIS.map((emo) => (
                          <button
                            key={emo}
                            type="button"
                            onClick={() => void handleReaction(msg.id, emo)}
                            className="rounded p-1 text-base hover:bg-white/10"
                          >
                            {emo}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Typing Indicator */}
      <div className="h-5 px-5 text-xs text-slate-400">
        {typingUsers.length > 0 && (
          <span>
            <strong className="text-slate-200">{typingUsers.map((t) => t.displayName).join(', ')}</strong>{' '}
            {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="relative px-4 pb-4">
        {uploadError && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <span>{uploadError}</span>
            <button type="button" onClick={() => setUploadError(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* @Mention Autocomplete */}
        {mentionHints.length > 0 && (
          <div className="mb-2 rounded-xl border border-white/10 bg-[#12151A] p-2 space-y-1 shadow-xl">
            <div className="px-2 text-[11px] font-semibold text-slate-400">Mention Member</div>
            {mentionHints.map((memberUser) => (
              <button
                key={memberUser.id}
                type="button"
                onClick={() => handleSelectMention(memberUser.username)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#1E222B]"
              >
                <UserAvatar user={memberUser} size="xs" showStatus />
                <span className="font-medium text-white">{memberUser.displayName}</span>
                <span className="font-mono text-slate-400">@{memberUser.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Slash Command Autocomplete */}
        {slashHints.length > 0 && (
          <div className="mb-2 rounded-xl border border-white/10 bg-[#12151A] p-2 space-y-1 shadow-xl">
            <div className="px-2 text-[11px] font-semibold text-slate-400">Slash Commands</div>
            {slashHints.map((h) => (
              <button
                key={h.cmd}
                type="button"
                onClick={() => {
                  setDraft(`${h.cmd} `);
                  composerInputRef.current?.focus();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#1E222B]"
              >
                <span className="font-mono font-semibold text-indigo-300">{h.cmd}</span>
                <span className="text-slate-400">{h.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Emoji & Studio Stickers Popover */}
        {showEmojiPicker && (
          <div className="mb-2 rounded-xl border border-white/10 bg-[#12151A] p-3 space-y-3 shadow-2xl">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">Emojis</div>
              <div className="flex flex-wrap gap-1.5">
                {STANDARD_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setDraft((d) => `${d}${em}`)}
                    className="rounded-lg bg-[#171A21] px-2 py-1 text-lg hover:bg-[#262B36]"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-amber-300 mb-1.5">
                <span>SNOUT NITRO Emojis</span>
                {!user?.isNitro && <span className="text-slate-500">Requires Nitro ($2/mo)</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {NITRO_EMOJIS.map((ne) => (
                  <button
                    key={ne.code}
                    type="button"
                    disabled={!user?.isNitro}
                    onClick={() => setDraft((d) => `${d} ${ne.code} `)}
                    className="rounded-lg bg-[#171A21] px-2.5 py-1 text-sm hover:bg-[#262B36] disabled:opacity-40"
                    title={ne.name}
                  >
                    {ne.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                <Sparkles className="h-3 w-3 text-[#818CF8]" />
                <span>Studio Reaction Stickers</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {STUDIO_STICKERS.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setDraft(st.token);
                      setShowEmojiPicker(false);
                      composerInputRef.current?.focus();
                    }}
                    className="rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#5865F2] hover:bg-[#262B36]"
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick Poll Builder */}
        {showPollBuilder && (
          <form
            onSubmit={handlePublishPoll}
            className="mb-2 rounded-xl border border-white/10 bg-[#12151A] p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span className="flex items-center gap-1.5">
                <BarChart2 className="h-4 w-4 text-[#818CF8]" />
                <span>Create Quick Reaction Poll</span>
              </span>
              <button
                type="button"
                onClick={() => setShowPollBuilder(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={opt}
                  onChange={(e) =>
                    setPollOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                  }
                  placeholder={`Option ${idx + 1}`}
                  className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs text-white focus:border-[#5865F2] focus:outline-none"
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              {pollOptions.length < 4 ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((p) => [...p, ''])}
                  className="text-xs text-indigo-300 hover:underline"
                >
                  + Add Option
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className="rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
              >
                Post Poll
              </button>
            </div>
          </form>
        )}

        {/* Formatting Quick-Insert Strip */}
        {showFormatBar && (
          <div className="mb-1.5 flex items-center gap-1 rounded-lg border border-white/10 bg-[#12151A] px-2.5 py-1 text-xs text-slate-300">
            <button
              type="button"
              title="Bold (Ctrl/Cmd+B)"
              onClick={() => wrapDraftFormat('**')}
              className="rounded p-1.5 hover:bg-white/10 hover:text-white"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Italic (Ctrl/Cmd+I)"
              onClick={() => wrapDraftFormat('*')}
              className="rounded p-1.5 hover:bg-white/10 hover:text-white"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Inline Code"
              onClick={() => wrapDraftFormat('`')}
              className="rounded p-1.5 hover:bg-white/10 hover:text-white"
            >
              <Code className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Code Block"
              onClick={() => wrapDraftFormat('```\n', '\n```')}
              className="rounded px-2 py-1 font-mono text-[11px] hover:bg-white/10 hover:text-white"
            >
              {'```'}
            </button>
            <button
              type="button"
              title="Quote"
              onClick={() => setDraft((d) => (d.startsWith('> ') ? d : `> ${d}`))}
              className="rounded p-1.5 hover:bg-white/10 hover:text-white"
            >
              <Quote className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between rounded-t-lg border border-b-0 border-white/10 bg-[#12151A] px-3 py-1.5 text-xs text-slate-300">
            <span>
              Replying to <strong className="text-white">{replyTo.author?.displayName}</strong>
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#12151A] px-2.5 py-1.5 text-xs text-slate-200"
              >
                <span className="truncate max-w-[160px]">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => setPendingAttachments((p) => p.filter((x) => x.id !== att.id))}
                  className="text-slate-400 hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {(channel?.type === 'FORUM' && (showForumComposer || forumTitle.length > 0)) && (
          <input
            type="text"
            value={forumTitle}
            onChange={(e) => setForumTitle(e.target.value)}
            placeholder="Forum post title..."
            className="mb-2 w-full rounded-lg border border-white/10 bg-[#12151A] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-[#5865F2] focus:outline-none"
          />
        )}

        <form
          onSubmit={handleSendMessage}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1E222B] px-3 py-2 focus-within:border-[#5865F2]/60 transition-colors"
        >
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
          <button
            type="button"
            disabled={!canSend}
            title={`Upload attachment (${user?.isNitro ? '100 MB Nitro' : '10 MB Standard'})`}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Plus className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            disabled={!canSend}
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="hidden sm:inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <button
            type="button"
            disabled={!canSend}
            title="Create Poll"
            onClick={() => setShowPollBuilder((s) => !s)}
            className={`hidden sm:inline-flex rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
              showPollBuilder ? 'bg-[#5865F2]/20 text-[#818CF8]' : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <BarChart2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            disabled={!canSend}
            title="Formatting Toolbar"
            onClick={() => setShowFormatBar((s) => !s)}
            className={`hidden sm:inline-flex rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
              showFormatBar ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Type className="h-4 w-4" />
          </button>

          <input
            ref={composerInputRef}
            type="text"
            disabled={!canSend}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                wrapDraftFormat('**');
                return;
              }
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                wrapDraftFormat('*');
                return;
              }
              if (e.key === 'ArrowUp' && !draft.trim() && latestOwnMsgId) {
                const lastOwn = messages.find((m) => m.id === latestOwnMsgId);
                if (lastOwn) {
                  e.preventDefault();
                  setEditingMsgId(lastOwn.id);
                  setEditingText(lastOwn.content);
                }
              }
            }}
            placeholder={
              canSend
                ? `Message ${channel ? `#${channel.name}` : headerTitle} (Markdown, @mention, /help)`
                : 'You do not have permission to send messages in this channel.'
            }
            className="flex-1 bg-transparent px-1 text-sm text-white placeholder-slate-500 focus:outline-none disabled:cursor-not-allowed"
          />

          <button
            type="button"
            disabled={!canSend}
            title={recordingVoice ? 'Stop Recording' : 'Record Voice Message'}
            onClick={() => void toggleVoiceMessageRecord()}
            className={`rounded-lg p-1.5 transition-colors ${
              recordingVoice
                ? 'bg-rose-500/20 text-rose-400'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {recordingVoice ? (
              <span className="flex items-center gap-1 font-mono text-xs">
                <Square className="h-3.5 w-3.5 fill-current" />
                {recordingSec}s
              </span>
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            title="Emojis & Stickers"
            onClick={() => setShowEmojiPicker((s) => !s)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <Smile className="h-4.5 w-4.5" />
          </button>

          <button
            type="submit"
            disabled={!canSend || (!draft.trim() && pendingAttachments.length === 0)}
            className="rounded-lg bg-[#5865F2] p-2 text-white hover:bg-[#4752C4] disabled:opacity-40 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="mb-3 flex w-full max-w-4xl items-center justify-between text-xs text-slate-300"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-mono truncate">{lightboxImage.filename}</span>
            <div className="flex items-center gap-3">
              <a
                href={lightboxImage.url}
                download={lightboxImage.filename}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/20"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </a>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <img
            src={lightboxImage.url}
            alt={lightboxImage.filename}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-xl border border-white/10 object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
