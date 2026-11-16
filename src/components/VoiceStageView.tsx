import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Headphones,
  HeadphoneOff,
  Globe2,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Music2,
  PanelRight,
  PhoneOff,
  PictureInPicture2,
  Radio,
  RefreshCw,
  Settings2,
  Signal,
  SignalHigh,
  SignalLow,
  SlidersHorizontal,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import type { Channel } from '../../shared/types.ts';
import { sanitizeCustomSoundCue, type CustomSoundCue } from '../../shared/soundboard.ts';
import { getChordSocket } from '../services/socket.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import {
  SOUNDBOARD_CUES,
  type StudioCueId,
  isStudioAudioMuted,
  playStudioCue,
  playCustomStudioCue,
  setStudioAudioMuted,
} from '../utils/studioAudio.ts';
import { UserAvatar } from './UserAvatar.tsx';

interface VoiceStageViewProps {
  channel: Channel;
  webrtc: ReturnType<typeof import('../hooks/useWebRTC.ts').useWebRTC>;
}

type StreamKind = 'camera' | 'screen';

interface StageStream {
  id: string;
  userId: string;
  stream: MediaStream;
  kind: StreamKind;
  label: string;
  isLocal: boolean;
  muted: boolean;
}

const PANEL_WIDTH_KEY = 'snout_voice_panel_width_v2';
const PANEL_OPEN_KEY = 'snout_voice_panel_open_v2';
const CUSTOM_SOUNDS_KEY = 'snout_custom_sounds_v1';

function readCustomSounds(): CustomSoundCue[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_SOUNDS_KEY) || '[]') as unknown[];
    return Array.isArray(saved)
      ? saved.map(sanitizeCustomSoundCue).filter((cue): cue is CustomSoundCue => Boolean(cue)).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function readNumber(key: string, fallback: number) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const RemoteAudio: React.FC<{ stream: MediaStream; muted: boolean; sinkId?: string }> = ({
  stream,
  muted,
  sinkId,
}) => {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId) {
      void el.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId, stream]);
  return <audio ref={ref} autoPlay playsInline muted={muted} className="hidden" aria-hidden="true" />;
};

const QualityPill: React.FC<{ state: string; rttMs: number | null }> = ({ state, rttMs }) => {
  const connected = state === 'connected';
  const reconnecting = state === 'reconnecting' || state === 'connecting';
  const Icon = connected ? (rttMs === null || rttMs < 90 ? SignalHigh : rttMs < 220 ? Signal : SignalLow) : reconnecting ? Signal : WifiOff;
  const tone = connected
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : reconnecting
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="capitalize">{reconnecting ? 'Reconnecting' : state}</span>
      {connected && rttMs !== null && <span className="font-mono tabular-nums opacity-80">{rttMs}ms</span>}
    </span>
  );
};

const VideoTile: React.FC<{
  item: StageStream;
  spotlight: boolean;
  compact?: boolean;
  onSpotlight: () => void;
  onFullscreen?: () => void;
}> = ({ item, spotlight, compact = false, onSpotlight, onFullscreen }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== item.stream) {
      el.srcObject = item.stream;
      void el.play().catch(() => {});
    }
  }, [item.stream]);

  const requestFullscreen = () => {
    if (onFullscreen) return onFullscreen();
    void shellRef.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div
      ref={shellRef}
      className={`group relative overflow-hidden rounded-xl border bg-[#0B0D11] transition-all ${
        spotlight ? 'border-[#5865F2]/60 shadow-[0_0_0_1px_rgba(88,101,242,0.25),0_18px_60px_rgba(0,0,0,0.45)]' : 'border-white/10 hover:border-white/20'
      } ${compact ? 'aspect-video' : spotlight ? 'aspect-video w-full' : 'aspect-video'}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={item.muted}
        className={`h-full w-full ${item.kind === 'screen' ? 'object-contain' : 'object-cover'}`}
        style={item.kind === 'camera' && item.isLocal ? { transform: 'scaleX(-1)' } : undefined}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-2.5 left-3 flex max-w-[70%] items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            item.kind === 'screen' ? 'bg-emerald-500/90 text-emerald-950' : 'bg-indigo-500/90 text-white'
          }`}
        >
          {item.kind === 'screen' ? <MonitorUp className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
          {item.kind === 'screen' ? 'Screen' : 'Camera'}
        </span>
        <span className="truncate rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          {item.label}
          {item.isLocal ? ' (You)' : ''}
        </span>
      </div>
      <div className="absolute right-2.5 top-2.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title={spotlight ? 'Remove spotlight' : 'Spotlight stream'}
          aria-label={spotlight ? 'Remove spotlight' : 'Spotlight stream'}
          onClick={onSpotlight}
          className="rounded-lg bg-black/65 p-1.5 text-slate-200 hover:bg-black/90 hover:text-white"
        >
          {spotlight ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title="Fullscreen"
          aria-label="Fullscreen"
          onClick={requestFullscreen}
          className="rounded-lg bg-black/65 p-1.5 text-slate-200 hover:bg-black/90 hover:text-white"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const AudioBars: React.FC<{ level: number; active: boolean }> = ({ level, active }) => {
  const heights = [0.4, 0.75, 1, 0.65, 0.35];
  return (
    <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {heights.map((mult, idx) => {
        const pct = active ? Math.max(18, Math.min(100, Math.round(level * mult))) : 16;
        return (
          <span
            key={idx}
            className={`w-1 rounded-sm transition-all duration-75 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
};

const StreamTileButton: React.FC<{ item: StageStream; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`w-full rounded-xl border p-2 text-left transition-colors ${
      active ? 'border-[#5865F2]/60 bg-[#5865F2]/10' : 'border-white/[0.07] bg-[#12151A] hover:border-white/20'
    }`}
  >
    <div className="relative mb-2 aspect-video overflow-hidden rounded-lg bg-black">
      <video
        autoPlay
        playsInline
        muted
        ref={(el) => {
          if (el && el.srcObject !== item.stream) {
            el.srcObject = item.stream;
            void el.play().catch(() => {});
          }
        }}
        className={`h-full w-full ${item.kind === 'screen' ? 'object-contain' : 'object-cover'}`}
      />
      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
        {item.kind}
      </span>
    </div>
    <div className="flex items-center gap-2">
      <span className="truncate text-xs font-medium text-white">{item.label}</span>
      {item.isLocal && <span className="text-[10px] text-indigo-300">You</span>}
    </div>
  </button>
);

export const VoiceStageView: React.FC<VoiceStageViewProps> = ({ channel, webrtc }) => {
  const {
    user,
    activeVoiceChannelId,
    voiceParticipantsByChannel,
    voiceMuted,
    voiceDeafened,
    voiceCameraOn,
    voiceScreenSharing,
    voicePushToTalk,
    voiceQuality,
    setInspectedUser,
    selectChannel,
  } = useChordStore();

  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [sfxMuted, setSfxMuted] = useState(() => isStudioAudioMuted());
  const [lastSoundBanner, setLastSoundBanner] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => readBool(PANEL_OPEN_KEY, true));
  const [panelWidth, setPanelWidth] = useState(() => Math.min(640, Math.max(260, readNumber(PANEL_WIDTH_KEY, 340))));
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [customSounds, setCustomSounds] = useState(readCustomSounds);
  const [customSoundName, setCustomSoundName] = useState('My tone');
  const [customSoundPitch, setCustomSoundPitch] = useState(440);
  const [customSoundDuration, setCustomSoundDuration] = useState(320);

  const isConnectedHere = activeVoiceChannelId === channel.id;
  const participants = voiceParticipantsByChannel[channel.id] || [];
  const participantMap = useMemo(() => new Map(participants.map((p) => [p.userId, p])), [participants]);

  const localScreenStream = webrtc.screenStream;
  const localCameraStream = webrtc.localStream?.getVideoTracks().length ? webrtc.localStream : null;

  const streams = useMemo<StageStream[]>(() => {
    const list: StageStream[] = [];
    if (localScreenStream) {
      list.push({
        id: 'local:screen',
        userId: user?.id || 'local',
        stream: localScreenStream,
        kind: 'screen',
        label: user?.displayName || 'You',
        isLocal: true,
        muted: true,
      });
    }
    if (localCameraStream) {
      list.push({
        id: 'local:camera',
        userId: user?.id || 'local',
        stream: localCameraStream,
        kind: 'camera',
        label: user?.displayName || 'You',
        isLocal: true,
        muted: true,
      });
    }
    for (const remote of webrtc.remoteVideos) {
      const participant = participantMap.get(remote.userId);
      list.push({
        id: `${remote.userId}:${remote.kind}`,
        userId: remote.userId,
        stream: remote.stream,
        kind: remote.kind,
        label: participant?.user?.displayName || participant?.user?.username || 'Participant',
        isLocal: false,
        muted: voiceDeafened,
      });
    }
    return list;
  }, [localCameraStream, localScreenStream, participantMap, user?.displayName, user?.id, voiceDeafened, webrtc.remoteVideos]);

  const screenStreams = streams.filter((s) => s.kind === 'screen');
  const cameraStreams = streams.filter((s) => s.kind === 'camera');

  useEffect(() => {
    if (spotlightId && !streams.some((s) => s.id === spotlightId)) {
      setSpotlightId(null);
    }
  }, [spotlightId, streams]);

  const spotlighted = streams.find((s) => s.id === spotlightId) || screenStreams[0] || null;

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      // ignore
    }
  }, [panelWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(panelOpen));
    } catch {
      // ignore
    }
  }, [panelOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selfParticipant = participants.find((p) => p.userId === user?.id);
  const joinedAt = selfParticipant?.joinedAt ? new Date(selfParticipant.joinedAt).getTime() : now;
  const activeOrBestRelay = webrtc.activeVoiceRelay || webrtc.voiceRelays[0] || null;
  const relayLatency = activeOrBestRelay
    ? webrtc.voiceRelays.find((relay) => relay.id === activeOrBestRelay.id)?.probeLatencyMs ?? null
    : null;

  useEffect(() => {
    const sock = getChordSocket();
    if (!sock || !isConnectedHere) return;
    const onSoundboard = (payload: { channelId: string; cueId: string; displayName: string }) => {
      if (payload.channelId !== channel.id) return;
      const customCue = sanitizeCustomSoundCue((payload as typeof payload & { customCue?: unknown }).customCue);
      if (customCue) playCustomStudioCue(customCue);
      else playStudioCue(payload.cueId as StudioCueId);
      const cueMeta = SOUNDBOARD_CUES.find((c) => c.id === payload.cueId);
      setLastSoundBanner(`${payload.displayName} played ${customCue?.name || cueMeta?.label || payload.cueId}`);
      window.setTimeout(() => setLastSoundBanner(null), 2600);
    };
    sock.on('voice:soundboard', onSoundboard);
    return () => {
      sock.off('voice:soundboard', onSoundboard);
    };
  }, [channel.id, isConnectedHere]);

  useEffect(() => {
    if (!isConnectedHere) return;
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable));
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        webrtc.toggleMute();
      } else if (key === 'd') {
        e.preventDefault();
        webrtc.toggleDeafen();
      } else if (key === 'v') {
        e.preventDefault();
        void webrtc.toggleCamera();
      } else if (key === 's') {
        e.preventDefault();
        void webrtc.toggleScreenShare();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isConnectedHere, webrtc]);

  const handleTriggerCue = (cueId: StudioCueId) => {
    const sock = getChordSocket();
    if (sock && isConnectedHere) {
      sock.emit('voice:soundboard', { channelId: channel.id, cueId });
    } else {
      playStudioCue(cueId);
    }
  };

  const saveCustomSound = (event: React.FormEvent) => {
    event.preventDefault();
    const name = customSoundName.trim().slice(0, 24);
    if (!name) return;
    const cue = sanitizeCustomSoundCue({
      id: crypto.randomUUID().replace(/-/g, ''),
      name,
      notes: [1, 1.25, 1.5].map((ratio) => ({
        frequency: Math.round(customSoundPitch * ratio),
        durationMs: customSoundDuration,
      })),
    });
    if (!cue) return;
    const next = [...customSounds.filter((item) => item.name !== cue.name), cue].slice(-6);
    setCustomSounds(next);
    try { localStorage.setItem(CUSTOM_SOUNDS_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
    setCustomSoundName('');
  };

  const handleTriggerCustomSound = (cue: CustomSoundCue) => {
    const sock = getChordSocket();
    if (sock && isConnectedHere) sock.emit('voice:soundboard', { channelId: channel.id, cueId: `custom-${cue.id}`, customCue: cue });
    else playCustomStudioCue(cue);
  };

  const toggleSfxMute = () => {
    const next = !sfxMuted;
    setSfxMuted(next);
    setStudioAudioMuted(next);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (e: PointerEvent) => {
      const next = Math.min(640, Math.max(260, startWidth + (startX - e.clientX)));
      setPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleSpotlight = (id: string) => {
    setSpotlightId((current) => (current === id ? null : id));
  };

  const goToVoiceChannel = () => {
    void selectChannel(channel.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#171A21]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isConnectedHere ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#5865F2]/15 text-[#818CF8]'}`}>
            <Radio className="h-4 w-4" />
            {isConnectedHere && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-sm font-semibold text-white">{channel.name}</h2>
              <span className="hidden rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline">
                Voice
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {isConnectedHere
                ? `${participants.length} participant${participants.length === 1 ? '' : 's'} · ${formatDuration(now - joinedAt)}`
                : participants.length > 0
                ? `${participants.length} participant${participants.length === 1 ? '' : 's'} connected`
                : 'No one is here yet'}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isConnectedHere && <QualityPill state={voiceQuality.state} rttMs={voiceQuality.rttMs} />}
          <div className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151A] px-2 py-1 sm:flex" title="Voice relay — auto picks the fastest TURN node for your network">
            <Globe2 className="h-3.5 w-3.5 text-indigo-300" />
            <select
              value={webrtc.voicePreference}
              onChange={(event) => webrtc.selectVoiceRelay(event.target.value)}
              aria-label="Voice relay"
              className="max-w-[190px] cursor-pointer truncate bg-transparent text-[11px] text-slate-200 focus:outline-none"
            >
              <option value="auto">
                Auto · {activeOrBestRelay ? `${activeOrBestRelay.name}${relayLatency !== null ? ` (${relayLatency}ms)` : ''}` : 'fastest relay'}
              </option>
              {webrtc.voiceRelays.map((relay) => (
                <option key={relay.id} value={relay.id}>
                  {relay.name} · {relay.probeLatencyMs === null ? 'probing…' : `${relay.probeLatencyMs}ms`}
                </option>
              ))}
            </select>
            {webrtc.relayProbing && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
          </div>
          <button
            type="button"
            onClick={() => void webrtc.refreshVoiceRelays()}
            className="hidden rounded-lg border border-white/10 bg-[#12151A] p-1.5 text-slate-400 hover:text-white sm:inline-flex"
            title="Re-measure relay latency"
            aria-label="Re-measure relay latency"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-pressed={panelOpen}
            title={panelOpen ? 'Hide call panel' : 'Show call panel'}
            className={`hidden rounded-lg border p-1.5 transition-colors sm:inline-flex ${
              panelOpen
                ? 'border-[#5865F2]/40 bg-[#5865F2]/15 text-indigo-200'
                : 'border-white/10 bg-[#12151A] text-slate-400 hover:text-white'
            }`}
          >
            {panelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {!isConnectedHere ? (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-lg space-y-6 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-[#1E222B] text-[#5865F2] shadow-inner">
              <Radio className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h3 className="font-display text-2xl font-bold text-white">{channel.name}</h3>
              <p className="mx-auto max-w-md text-sm text-slate-400">
                {participants.length === 0
                  ? 'No one is currently in this voice channel. Join to start speaking, turn on your camera, or broadcast your screen.'
                  : `${participants.length} participant${participants.length === 1 ? '' : 's'} active. Join the call to listen and speak.`}
              </p>
            </div>

            {participants.length > 0 && (
              <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2">
                {participants.map((participant) => (
                  <button
                    key={participant.userId}
                    type="button"
                    onClick={() => participant.user && setInspectedUser(participant.user)}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-[#12151A] px-2.5 py-1.5 text-xs text-slate-200 hover:border-white/25"
                  >
                    <UserAvatar user={participant.user} size="xs" speaking={participant.speaking} />
                    <span>{participant.user?.displayName || participant.user?.username || 'Participant'}</span>
                    {participant.screenSharing && <MonitorUp className="h-3 w-3 text-emerald-400" />}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  playStudioCue('join');
                  void webrtc.joinVoiceChannel(channel.id, channel.serverId);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition-transform hover:scale-[1.02] hover:bg-[#4752C4] active:scale-[0.99]"
              >
                <Radio className="h-4 w-4" />
                Join Voice Channel
              </button>
              {activeVoiceChannelId && activeVoiceChannelId !== channel.id && (
                <button
                  type="button"
                  onClick={goToVoiceChannel}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#12151A] px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-[#1E222B]"
                >
                  Return to current call
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Tip: M mute · D deafen · V camera · S screen share
            </p>
            <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-[#12151A] px-3 py-2 text-[11px] text-slate-400">
              <Globe2 className="h-3.5 w-3.5 text-indigo-300" />
              <span>
                Relay:{' '}
                <span className="font-medium text-slate-200">
                  {webrtc.voicePreference === 'auto' ? 'Auto' : 'Manual'} · {activeOrBestRelay?.name || 'server default'}
                </span>
                {relayLatency !== null ? ` · ${relayLatency}ms` : ''}
              </span>
              <button type="button" onClick={() => void webrtc.refreshVoiceRelays()} className="ml-1 text-indigo-300 hover:text-indigo-200">
                {webrtc.relayProbing ? 'measuring…' : 'measure'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
            <div className="space-y-4">
              {webrtc.mediaError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span className="flex-1">{webrtc.mediaError}</span>
                  <button type="button" onClick={webrtc.clearMediaError} className="text-rose-300 hover:text-white">
                    Dismiss
                  </button>
                </div>
              )}

              {webrtc.micPermissionError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>{webrtc.micPermissionError}</span>
                </div>
              )}

              {lastSoundBanner && (
                <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs text-indigo-200">
                  <Music2 className="h-4 w-4 text-[#818CF8]" />
                  <span>{lastSoundBanner}</span>
                </div>
              )}

              {spotlighted ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Spotlight · {spotlighted.kind === 'screen' ? 'Screen share' : 'Camera'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSpotlightId(null)}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      Exit spotlight
                    </button>
                  </div>
                  <VideoTile
                    item={spotlighted}
                    spotlight
                    onSpotlight={() => handleSpotlight(spotlighted.id)}
                  />
                </div>
              ) : cameraStreams.length > 0 ? (
                <div className={`grid gap-3 ${cameraStreams.length === 1 ? 'md:grid-cols-1' : cameraStreams.length === 2 ? 'md:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
                  {cameraStreams.map((item) => (
                    <VideoTile
                      key={item.id}
                      item={item}
                      spotlight={false}
                      onSpotlight={() => handleSpotlight(item.id)}
                    />
                  ))}
                </div>
              ) : null}

              {screenStreams.length > 0 && spotlighted?.kind !== 'screen' && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shared screens</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {screenStreams.map((item) => (
                      <VideoTile
                        key={item.id}
                        item={item}
                        spotlight={false}
                        onSpotlight={() => handleSpotlight(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-1">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    In this call · {participants.length}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    Live
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {participants.map((participant) => {
                    const isSelf = participant.userId === user?.id;
                    const isSpeaking = isSelf ? webrtc.speakingLocal : participant.speaking;
                    const level = isSelf ? webrtc.audioLevel : participant.speaking ? 72 : 0;
                    const hasVideo = streams.some((s) => s.userId === participant.userId && s.kind === 'camera');
                    return (
                      <div
                        key={participant.userId}
                        className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border p-5 transition-all ${
                          isSpeaking ? 'border-emerald-500/60 bg-[#17231f] shadow-[0_0_24px_rgba(16,185,129,0.08)]' : 'border-white/[0.07] bg-[#12151A]'
                        }`}
                      >
                        {isSpeaking && <span className="absolute inset-x-0 top-0 h-0.5 bg-emerald-400" />}
                        <UserAvatar
                          user={participant.user}
                          size="lg"
                          speaking={isSpeaking}
                          onClick={participant.user ? () => setInspectedUser(participant.user!) : undefined}
                        />
                        <div className="w-full text-center">
                          <div className="flex items-center justify-center gap-1.5 truncate text-sm font-semibold text-white">
                            <span className="truncate">{participant.user?.displayName || participant.user?.username || 'Participant'}</span>
                            {isSelf && <span className="text-[10px] font-medium text-indigo-300">You</span>}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
                            <AudioBars level={level} active={isSpeaking && !participant.muted} />
                            {participant.muted && (
                              <span className="inline-flex items-center gap-0.5 text-rose-400">
                                <MicOff className="h-3 w-3" /> Muted
                              </span>
                            )}
                            {participant.deafened && (
                              <span className="inline-flex items-center gap-0.5 text-rose-400">
                                <HeadphoneOff className="h-3 w-3" /> Deafened
                              </span>
                            )}
                            {participant.cameraOn && (
                              <span className="inline-flex items-center gap-0.5 text-indigo-300">
                                <Video className="h-3 w-3" /> Camera
                              </span>
                            )}
                            {participant.screenSharing && (
                              <span className="inline-flex items-center gap-0.5 text-emerald-300">
                                <MonitorUp className="h-3 w-3" /> Screen
                              </span>
                            )}
                            {participant.pushToTalk && <span className="text-amber-300">PTT</span>}
                            {!participant.muted && !participant.deafened && !participant.cameraOn && !participant.screenSharing && (
                              <span>{isSpeaking ? 'Speaking' : 'Listening'}</span>
                            )}
                          </div>
                        </div>
                        {hasVideo && !spotlighted && (
                          <button
                            type="button"
                            onClick={() => handleSpotlight(`${participant.userId}:camera`)}
                            className="absolute right-2 top-2 rounded-md bg-black/50 p-1 text-slate-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                            title="Spotlight camera"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {participants.length === 0 && (
                    <div className="col-span-full rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-500">
                      Waiting for participants to join…
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Resizable call panel */}
          {panelOpen && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize call panel"
                onPointerDown={startResize}
                onDoubleClick={() => setPanelWidth(340)}
                className="absolute inset-y-0 z-30 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-[#5865F2]/40 sm:block min-[1100px]:hidden"
                style={{ right: panelWidth }}
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize call panel"
                onPointerDown={startResize}
                onDoubleClick={() => setPanelWidth(340)}
                className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[#5865F2]/40 min-[1100px]:block"
              />
              <aside
                className="absolute inset-y-0 right-0 z-20 hidden shrink-0 flex-col border-l border-white/[0.06] bg-[#12151A] shadow-2xl sm:flex min-[1100px]:static min-[1100px]:z-auto min-[1100px]:shadow-none"
                style={{ width: panelWidth }}
              >
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <PanelRight className="h-4 w-4 text-[#818CF8]" />
                    <span>Call panel</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                    title="Hide panel"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto p-3">
                  <section className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Live streams</span>
                      <span className="font-mono text-[10px] tabular-nums text-slate-500">{streams.length}</span>
                    </div>
                    {streams.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-slate-500">
                        No camera or screen streams yet. When someone shares, it appears here.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {streams.map((item) => (
                          <StreamTileButton
                            key={item.id}
                            item={item}
                            active={spotlightId === item.id}
                            onClick={() => handleSpotlight(item.id)}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Participants</span>
                      <span className="font-mono text-[10px] tabular-nums text-slate-500">{participants.length}</span>
                    </div>
                    <div className="space-y-1">
                      {participants.map((participant) => (
                        <button
                          key={participant.userId}
                          type="button"
                          onClick={() => participant.user && setInspectedUser(participant.user)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.05]"
                        >
                          <UserAvatar user={participant.user} size="xs" speaking={participant.speaking} />
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-200">
                            {participant.user?.displayName || participant.user?.username || 'Participant'}
                          </span>
                          <span className="flex items-center gap-1 text-slate-400">
                            {participant.muted ? <MicOff className="h-3 w-3 text-rose-400" /> : <Mic className="h-3 w-3" />}
                            {participant.cameraOn && <Video className="h-3 w-3 text-indigo-300" />}
                            {participant.screenSharing && <MonitorUp className="h-3 w-3 text-emerald-300" />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Panel size</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        ['Compact', 280],
                        ['Normal', 380],
                        ['Wide', 520],
                      ].map(([label, width]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setPanelWidth(width as number)}
                          className={`rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-colors ${
                            panelWidth === width
                              ? 'border-[#5865F2]/50 bg-[#5865F2]/15 text-indigo-200'
                              : 'border-white/10 bg-[#0D0F12] text-slate-400 hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500">Drag the divider to resize. Double-click it to reset.</p>
                  </section>

                  <section className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shortcuts</div>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <div className="flex justify-between"><span>Mute</span><kbd className="rounded bg-white/10 px-1.5 font-mono">M</kbd></div>
                      <div className="flex justify-between"><span>Deafen</span><kbd className="rounded bg-white/10 px-1.5 font-mono">D</kbd></div>
                      <div className="flex justify-between"><span>Camera</span><kbd className="rounded bg-white/10 px-1.5 font-mono">V</kbd></div>
                      <div className="flex justify-between"><span>Screen share</span><kbd className="rounded bg-white/10 px-1.5 font-mono">S</kbd></div>
                    </div>
                  </section>
                </div>
              </aside>
            </>
          )}
        </div>
      )}

      {isConnectedHere && (
        <footer className="relative shrink-0 space-y-2.5 border-t border-white/[0.06] bg-[#12151A] px-3 py-3 sm:px-6">
          {devicesOpen && (
            <div className="absolute bottom-[calc(100%-0.25rem)] left-1/2 z-30 w-[min(92vw,430px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0D0F12] p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <SlidersHorizontal className="h-4 w-4 text-[#818CF8]" />
                  Voice & video settings
                </div>
                <button type="button" onClick={() => setDevicesOpen(false)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 text-xs">
                <label className="block space-y-1">
                  <span className="font-medium text-slate-300">Microphone</span>
                  <select
                    value={webrtc.selectedMicId}
                    onChange={(e) => void webrtc.selectMicrophone(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2 text-white"
                  >
                    <option value="">System default</option>
                    {webrtc.microphones.map((device, index) => (
                      <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-300">Camera</span>
                  <select
                    value={webrtc.selectedCameraId}
                    onChange={(e) => void webrtc.selectCamera(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2 text-white"
                  >
                    <option value="">System default</option>
                    {webrtc.cameras.map((device, index) => (
                      <option key={device.deviceId || `cam-${index}`} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-300">Speaker</span>
                  <select
                    value={webrtc.selectedSpeakerId}
                    onChange={(e) => webrtc.selectSpeaker(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2 text-white"
                  >
                    <option value="">System default</option>
                    {webrtc.speakers.map((device, index) => (
                      <option key={device.deviceId || `spk-${index}`} value={device.deviceId}>
                        {device.label || `Speaker ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="font-medium text-slate-300">Video quality</span>
                    <select
                      value={webrtc.videoQuality}
                      onChange={(e) => void webrtc.setVideoQuality(e.target.value as typeof webrtc.videoQuality)}
                      className="w-full rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2 text-white"
                    >
                      <option value="480p">480p · light</option>
                      <option value="720p">720p · HD</option>
                      <option value="1080p">1080p · Full HD</option>
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2">
                    <span className="font-medium text-slate-300">Noise suppression</span>
                    <input
                      type="checkbox"
                      checked={webrtc.noiseSuppression}
                      onChange={() => void webrtc.toggleNoiseSuppression()}
                      className="h-4 w-4 accent-[#5865F2]"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <Music2 className="h-3.5 w-3.5 text-[#818CF8]" />
              Soundboard
            </span>
            {SOUNDBOARD_CUES.map((cue) => (
              <button
                key={cue.id}
                type="button"
                title={cue.description}
                onClick={() => handleTriggerCue(cue.id)}
                className="rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-[#5865F2] hover:text-white"
              >
                {cue.label}
              </button>
            ))}
            {customSounds.map((cue) => (
              <button
                key={cue.id}
                type="button"
                title="Play custom tone"
                onClick={() => handleTriggerCustomSound(cue)}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20"
              >
                {cue.name}
              </button>
            ))}
            <form onSubmit={saveCustomSound} className="flex flex-wrap items-center justify-center gap-1.5">
              <input aria-label="Custom sound name" value={customSoundName} onChange={(event) => setCustomSoundName(event.target.value)} maxLength={24}
                className="w-24 rounded-md border border-white/10 bg-[#0D0F12] px-2 py-1 text-[11px] text-white" />
              <label className="flex items-center gap-1 text-[10px] text-slate-400" title={`Pitch ${customSoundPitch} hertz`}>
                <span>Pitch</span><input aria-label="Custom sound pitch" type="range" min="160" max="1000" step="10" value={customSoundPitch} onChange={(event) => setCustomSoundPitch(Number(event.target.value))} className="w-14 accent-emerald-400" />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-slate-400" title={`Duration ${customSoundDuration} milliseconds`}>
                <span>Length</span><input aria-label="Custom sound duration" type="range" min="100" max="900" step="50" value={customSoundDuration} onChange={(event) => setCustomSoundDuration(Number(event.target.value))} className="w-14 accent-emerald-400" />
              </label>
              <button type="submit" disabled={!customSoundName.trim()} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-40">
                Add tone
              </button>
            </form>
            <button
              type="button"
              title={sfxMuted ? 'Unmute sound effects' : 'Mute sound effects'}
              onClick={toggleSfxMute}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
                sfxMuted ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-[#171A21] text-slate-400 hover:text-white'
              }`}
            >
              {sfxMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
              <span>{sfxMuted ? 'SFX off' : 'SFX on'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => {
                playStudioCue(voiceMuted ? 'unmute' : 'mute');
                webrtc.toggleMute();
              }}
              title={voiceMuted ? 'Unmute (M)' : 'Mute (M)'}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:px-4 ${
                voiceMuted ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'bg-[#1E222B] text-white hover:bg-[#262B36]'
              }`}
            >
              {voiceMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span className="hidden sm:inline">{voiceMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            <button
              type="button"
              onClick={webrtc.toggleDeafen}
              title={voiceDeafened ? 'Undeafen (D)' : 'Deafen (D)'}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:px-4 ${
                voiceDeafened ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'bg-[#1E222B] text-white hover:bg-[#262B36]'
              }`}
            >
              {voiceDeafened ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
              <span className="hidden sm:inline">{voiceDeafened ? 'Undeafen' : 'Deafen'}</span>
            </button>

            <button
              type="button"
              onClick={() => void webrtc.toggleCamera()}
              title="Toggle camera (V)"
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:px-4 ${
                voiceCameraOn ? 'bg-[#5865F2] text-white hover:bg-[#4752C4]' : 'bg-[#1E222B] text-white hover:bg-[#262B36]'
              }`}
            >
              {voiceCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              <span className="hidden sm:inline">Camera</span>
            </button>

            <button
              type="button"
              onClick={() => void webrtc.toggleScreenShare()}
              title="Share screen (S)"
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:px-4 ${
                voiceScreenSharing ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-[#1E222B] text-white hover:bg-[#262B36]'
              }`}
            >
              <MonitorUp className="h-4 w-4" />
              <span className="hidden sm:inline">{voiceScreenSharing ? 'Stop share' : 'Share screen'}</span>
            </button>

            <button
              type="button"
              onClick={() => setDevicesOpen((open) => !open)}
              title="Audio & video devices"
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                devicesOpen ? 'bg-[#5865F2]/20 text-indigo-200' : 'bg-[#1E222B] text-slate-300 hover:bg-[#262B36]'
              }`}
            >
              <Settings2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={webrtc.togglePushToTalk}
              title="Push to talk"
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                voicePushToTalk ? 'border border-amber-500/30 bg-amber-500/20 text-amber-300' : 'bg-[#1E222B] text-slate-300 hover:bg-[#262B36]'
              }`}
            >
              {voicePushToTalk ? 'PTT · hold Space' : 'Voice activity'}
            </button>

            <button
              type="button"
              onClick={() => {
                playStudioCue('leave');
                webrtc.leaveVoiceChannel();
              }}
              className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
            >
              <PhoneOff className="h-4 w-4" />
              <span>Disconnect</span>
            </button>
          </div>
        </footer>
      )}

      {voiceDeafened &&
        webrtc.remoteAudioStreams.map((audio) => (
          <RemoteAudio key={`${audio.userId}-${audio.stream.id}`} stream={audio.stream} muted sinkId={webrtc.selectedSpeakerId} />
        ))}
      {!voiceDeafened &&
        webrtc.remoteAudioStreams.map((audio) => (
          <RemoteAudio key={`${audio.userId}-${audio.stream.id}`} stream={audio.stream} muted={false} sinkId={webrtc.selectedSpeakerId} />
        ))}
    </div>
  );
};
