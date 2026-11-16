import { useCallback, useEffect, useRef, useState } from 'react';
import { getChordSocket } from '../services/socket.ts';
import { apiRequest } from '../services/api.ts';
import {
  fetchVoiceNodes,
  getVoicePreference,
  pickVoiceNodeForJoin,
  refreshVoiceNodeScores,
  setVoicePreference,
  type ScoredVoiceNode,
  type VoicePreference,
} from '../services/voiceNodes.ts';
import { useChordStore } from '../stores/useChordStore.ts';

export type MediaStreamKind = 'audio' | 'camera' | 'screen' | 'screenAudio';

export interface RemoteVideoStream {
  userId: string;
  stream: MediaStream;
  kind: 'camera' | 'screen';
}

export interface RemoteAudioStream {
  userId: string;
  stream: MediaStream;
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
}

export type VideoQuality = '480p' | '720p' | '1080p';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const RTC_CONFIG: RTCConfiguration = {
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
};

const QUALITY_CONSTRAINTS: Record<VideoQuality, { width: number; height: number; frameRate: number }> = {
  '480p': { width: 854, height: 480, frameRate: 30 },
  '720p': { width: 1280, height: 720, frameRate: 30 },
  '1080p': { width: 1920, height: 1080, frameRate: 60 },
};

const MIC_STORAGE_KEY = 'snout_preferred_mic';
const CAMERA_STORAGE_KEY = 'snout_preferred_camera';
const SPEAKER_STORAGE_KEY = 'snout_preferred_speaker';
const QUALITY_STORAGE_KEY = 'snout_video_quality';

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage may be unavailable (private mode / SSR)
  }
}

interface PeerEntry {
  peerId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  needsNegotiation: boolean;
  closed: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  senders: Map<MediaStreamKind, RTCRtpSender>;
  remoteTrackIds: Set<string>;
  syncChain: Promise<void>;
  disconnectTimer: number | null;
}

type TrackMap = Partial<Record<MediaStreamKind, MediaStreamTrack>>;
type StreamMap = Partial<Record<MediaStreamKind, MediaStream>>;

export function useWebRTC() {
  const {
    user,
    activeVoiceChannelId,
    voiceMuted,
    voiceDeafened,
    voiceCameraOn,
    voiceScreenSharing,
    voicePushToTalk,
    setVoiceSession,
    setVoiceFlags,
  } = useChordStore();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideoStream[]>([]);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<RemoteAudioStream[]>([]);
  const [speakingLocal, setSpeakingLocal] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState(() => readStorage(MIC_STORAGE_KEY, ''));
  const [selectedCameraId, setSelectedCameraId] = useState(() => readStorage(CAMERA_STORAGE_KEY, ''));
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(() => readStorage(SPEAKER_STORAGE_KEY, ''));
  const [videoQuality, setVideoQualityState] = useState<VideoQuality>(() => {
    const stored = readStorage(QUALITY_STORAGE_KEY, '720p');
    return stored === '480p' || stored === '1080p' ? stored : '720p';
  });
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [voiceRelays, setVoiceRelays] = useState<ScoredVoiceNode[]>([]);
  const [activeVoiceRelay, setActiveVoiceRelay] = useState<{ id: string; name: string; regionLabel: string } | null>(null);
  const [voicePreference, setVoicePreferenceState] = useState<VoicePreference>(() => getVoicePreference());
  const [relayProbing, setRelayProbing] = useState(false);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const localTracksRef = useRef<TrackMap>({});
  const localStreamsRef = useRef<StreamMap>({});
  const remoteMetaRef = useRef<Map<string, Record<string, 'camera' | 'screen'>>>(new Map());
  const remoteAudioTracksRef = useRef<Map<string, MediaStreamTrack[]>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const channelIdRef = useRef<string | null>(activeVoiceChannelId);
  const joinRequestRef = useRef(0);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  const preDeafenMutedRef = useRef(false);
  const selectedMicRef = useRef(selectedMicId);
  const selectedCameraRef = useRef(selectedCameraId);
  const qualityRef = useRef<VideoQuality>(videoQuality);
  const noiseSuppressionRef = useRef(noiseSuppression);
  const voicePreferenceRef = useRef<VoicePreference>(voicePreference);

  channelIdRef.current = activeVoiceChannelId;
  userIdRef.current = user?.id ?? null;
  selectedMicRef.current = selectedMicId;
  selectedCameraRef.current = selectedCameraId;
  qualityRef.current = videoQuality;
  noiseSuppressionRef.current = noiseSuppression;
  voicePreferenceRef.current = voicePreference;

  const rebuildLocalStream = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (localTracksRef.current.audio) tracks.push(localTracksRef.current.audio);
    if (localTracksRef.current.camera) tracks.push(localTracksRef.current.camera);
    if (tracks.length === 0) {
      setLocalStream(null);
      return;
    }
    setLocalStream(new MediaStream(tracks));
  }, []);

  const stopVad = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
    setSpeakingLocal(false);
  }, []);

  const startVad = useCallback(
    (stream: MediaStream | null) => {
      stopVad();
      const track = stream?.getAudioTracks()[0];
      if (!track) return;
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        const ctx = new AudioContextClass();
        audioCtxRef.current = ctx;
        void ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        src.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const poll = () => {
          if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const state = useChordStore.getState();
          const mutedNow = state.voiceMuted || state.voiceDeafened;
          setAudioLevel(mutedNow ? 0 : Math.min(100, Math.round((avg / 82) * 100)));
          const isSpeakingNow = avg > 15 && !mutedNow;
          setSpeakingLocal((prev) => {
            if (prev !== isSpeakingNow) {
              getChordSocket()?.emit('voice:state', { speaking: isSpeakingNow });
            }
            return isSpeakingNow;
          });
          vadRafRef.current = requestAnimationFrame(poll);
        };
        vadRafRef.current = requestAnimationFrame(poll);
      } catch {
        // Audio analysis is a progressive enhancement.
      }
    },
    [stopVad]
  );

  const removeRemoteUser = useCallback((peerId: string) => {
    setRemoteVideos((prev) => prev.filter((v) => v.userId !== peerId));
    remoteAudioTracksRef.current.delete(peerId);
    setRemoteAudioStreams((prev) => prev.filter((a) => a.userId !== peerId));
  }, []);

  const cleanupAllPeers = useCallback(() => {
    for (const entry of peersRef.current.values()) {
      entry.closed = true;
      if (entry.disconnectTimer) window.clearTimeout(entry.disconnectTimer);
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    }
    peersRef.current.clear();
    remoteMetaRef.current.clear();
    remoteAudioTracksRef.current.clear();
    setRemoteVideos([]);
    setRemoteAudioStreams([]);

    Object.values(localTracksRef.current).forEach((track) => track?.stop());
    localTracksRef.current = {};
    localStreamsRef.current = {};
    setLocalStream(null);
    setScreenStream(null);
    stopVad();
    setMediaError(null);
  }, [stopVad]);

  const getStreamMap = useCallback((): Record<string, 'camera' | 'screen'> => {
    const map: Record<string, 'camera' | 'screen'> = {};
    if (localStreamsRef.current.camera) map[localStreamsRef.current.camera.id] = 'camera';
    if (localStreamsRef.current.screen) map[localStreamsRef.current.screen.id] = 'screen';
    return map;
  }, []);

  const syncPeerTracks = useCallback((entry: PeerEntry): Promise<void> => {
    entry.syncChain = entry.syncChain
      .then(async () => {
        if (entry.closed) return;
        for (const kind of ['audio', 'camera', 'screen', 'screenAudio'] as MediaStreamKind[]) {
          const track = localTracksRef.current[kind];
          const stream = localStreamsRef.current[kind];
          const sender = entry.senders.get(kind);
          if (track && stream) {
            if (sender) {
              if (sender.track !== track) {
                await sender.replaceTrack(track).catch(() => {});
              }
            } else {
              try {
                const newSender = entry.pc.addTrack(track, stream);
                entry.senders.set(kind, newSender);
              } catch {
                // Connection may be closing.
              }
            }
          } else if (sender) {
            try {
              entry.pc.removeTrack(sender);
            } catch {
              // ignore
            }
            entry.senders.delete(kind);
          }
        }
      })
      .catch(() => {});
    return entry.syncChain;
  }, []);

  const sendOffer = useCallback(
    async (entry: PeerEntry) => {
      if (entry.closed || entry.makingOffer) return;
      if (entry.pc.signalingState !== 'stable') return;
      entry.makingOffer = true;
      entry.needsNegotiation = false;
      try {
        const offer = await entry.pc.createOffer();
        if (entry.closed || entry.pc.signalingState !== 'stable') return;
        await entry.pc.setLocalDescription(offer);
        getChordSocket()?.emit('webrtc:offer', {
          targetUserId: entry.peerId,
          channelId: channelIdRef.current,
          sdp: entry.pc.localDescription,
          streamMap: getStreamMap(),
        });
      } catch {
        // Offer can fail while the connection is being torn down.
      } finally {
        entry.makingOffer = false;
      }
    },
    [getStreamMap]
  );

  const flushCandidates = useCallback(async (entry: PeerEntry) => {
    if (!entry.pc.remoteDescription) return;
    const queued = entry.pendingCandidates.splice(0);
    for (const candidate of queued) {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing && !existing.closed) return existing;
      if (existing) peersRef.current.delete(peerId);

      const pc = new RTCPeerConnection({ ...RTC_CONFIG, iceServers: iceServersRef.current });
      const selfId = userIdRef.current || '';
      const entry: PeerEntry = {
        peerId,
        pc,
        polite: selfId.localeCompare(peerId) < 0,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        needsNegotiation: false,
        closed: false,
        pendingCandidates: [],
        senders: new Map(),
        remoteTrackIds: new Set(),
        syncChain: Promise.resolve(),
        disconnectTimer: null,
      };

      peersRef.current.set(peerId, entry);

      pc.onnegotiationneeded = () => {
        if (entry.closed) return;
        if (entry.makingOffer || entry.pc.signalingState !== 'stable') {
          entry.needsNegotiation = true;
          return;
        }
        void sendOffer(entry);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || entry.closed) return;
        getChordSocket()?.emit('webrtc:ice-candidate', {
          targetUserId: peerId,
          channelId: channelIdRef.current,
          candidate: event.candidate,
        });
      };

      pc.ontrack = (event) => {
        if (entry.closed) return;
        const track = event.track;
        const stream = event.streams[0] || new MediaStream([track]);
        entry.remoteTrackIds.add(track.id);

        if (track.kind === 'video') {
          const meta = remoteMetaRef.current.get(peerId);
          const kind: 'camera' | 'screen' = meta?.[stream.id] === 'screen' ? 'screen' : 'camera';
          const videoStream = new MediaStream([track]);
          setRemoteVideos((prev) => [
            ...prev.filter((v) => !(v.userId === peerId && v.kind === kind)),
            { userId: peerId, stream: videoStream, kind },
          ]);
          track.addEventListener('ended', () => {
            setRemoteVideos((prev) =>
              prev.filter((v) => !(v.userId === peerId && v.stream.getVideoTracks()[0]?.id === track.id))
            );
          });
        } else {
          const current = remoteAudioTracksRef.current.get(peerId) || [];
          if (!current.some((t) => t.id === track.id)) {
            const nextTracks = [...current, track];
            remoteAudioTracksRef.current.set(peerId, nextTracks);
            setRemoteAudioStreams((prev) => [
              ...prev.filter((a) => a.userId !== peerId),
              { userId: peerId, stream: new MediaStream(nextTracks) },
            ]);
          }
          track.addEventListener('ended', () => {
            const remaining = (remoteAudioTracksRef.current.get(peerId) || []).filter((t) => t.id !== track.id);
            if (remaining.length === 0) {
              remoteAudioTracksRef.current.delete(peerId);
              setRemoteAudioStreams((prev) => prev.filter((a) => a.userId !== peerId));
            } else {
              remoteAudioTracksRef.current.set(peerId, remaining);
              setRemoteAudioStreams((prev) => [
                ...prev.filter((a) => a.userId !== peerId),
                { userId: peerId, stream: new MediaStream(remaining) },
              ]);
            }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (entry.closed) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          if (entry.disconnectTimer) {
            window.clearTimeout(entry.disconnectTimer);
            entry.disconnectTimer = null;
          }
          setVoiceFlags({ voiceQuality: { rttMs: null, state: 'connected' } });
        } else if (state === 'connecting') {
          setVoiceFlags({ voiceQuality: { rttMs: null, state: 'connecting' } });
        } else if (state === 'disconnected') {
          setVoiceFlags({ voiceQuality: { rttMs: null, state: 'reconnecting' } });
          if (!entry.disconnectTimer) {
            entry.disconnectTimer = window.setTimeout(() => {
              entry.disconnectTimer = null;
              if (entry.closed) return;
              try {
                pc.restartIce();
              } catch {
                // ignore
              }
              if (pc.signalingState === 'stable') void sendOffer(entry);
            }, 2500);
          }
        } else if (state === 'failed') {
          setVoiceFlags({ voiceQuality: { rttMs: null, state: 'reconnecting' } });
          try {
            pc.restartIce();
          } catch {
            // ignore
          }
          if (pc.signalingState === 'stable') void sendOffer(entry);
        }
      };

      void syncPeerTracks(entry);

      return entry;
    },
    [getStreamMap, sendOffer, setVoiceFlags, syncPeerTracks]
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const toOption = (d: MediaDeviceInfo): MediaDeviceOption => ({
        deviceId: d.deviceId,
        label: d.label,
        kind: d.kind as MediaDeviceOption['kind'],
      });
      setMicrophones(devices.filter((d) => d.kind === 'audioinput').map(toOption));
      setCameras(devices.filter((d) => d.kind === 'videoinput').map(toOption));
      setSpeakers(devices.filter((d) => d.kind === 'audiooutput').map(toOption));
    } catch {
      // Device enumeration requires permission in some browsers.
    }
  }, []);

  const syncAllPeers = useCallback(async () => {
    await Promise.all(Array.from(peersRef.current.values()).map((entry) => syncPeerTracks(entry)));
  }, [syncPeerTracks]);

  const joinVoiceChannel = useCallback(
    async (channelId: string, serverId: string | null) => {
      const requestId = ++joinRequestRef.current;
      setMicPermissionError(null);
      setMediaError(null);
      let microphoneStream: MediaStream | null = null;

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicPermissionError(
          'Voice and video need a secure connection (HTTPS) or localhost. Ask the server owner to enable HTTPS.'
        );
      } else {
        try {
          const audio: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: noiseSuppressionRef.current,
            autoGainControl: true,
          };
          if (selectedMicRef.current) audio.deviceId = { exact: selectedMicRef.current };
          microphoneStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        } catch (err) {
          const name = (err as DOMException)?.name;
          setMicPermissionError(
            name === 'NotAllowedError'
              ? 'Microphone permission was denied. You are connected in listen-only mode.'
              : 'No microphone available. You are connected in listen-only mode.'
          );
        }
        await refreshDevices();
      }

      if (requestId !== joinRequestRef.current) {
        microphoneStream?.getTracks().forEach((track) => track.stop());
        return;
      }

      try {
        let relayNodeId: string | null = null;
        try {
          await fetchVoiceNodes();
          relayNodeId = pickVoiceNodeForJoin(voicePreferenceRef.current);
        } catch {
          // Relay discovery is optional — the API still resolves a node.
        }
        const query = relayNodeId ? `?nodeId=${encodeURIComponent(relayNodeId)}` : '';
        const config = await apiRequest<{
          iceServers?: RTCIceServer[];
          nodeId?: string | null;
          nodeName?: string | null;
          regionLabel?: string | null;
        }>(`/api/voice/ice-config${query}`);
        if (requestId !== joinRequestRef.current) {
          microphoneStream?.getTracks().forEach((track) => track.stop());
          return;
        }
        iceServersRef.current = config.iceServers?.length ? config.iceServers : DEFAULT_ICE_SERVERS;
        if (config.nodeId) {
          setActiveVoiceRelay({
            id: config.nodeId,
            name: config.nodeName || 'Voice relay',
            regionLabel: config.regionLabel || '',
          });
        }
      } catch {
        iceServersRef.current = DEFAULT_ICE_SERVERS;
      }

      cleanupAllPeers();
      setVoiceSession(channelId, serverId);
      const track = microphoneStream?.getAudioTracks()[0];
      if (track && microphoneStream) {
        localTracksRef.current.audio = track;
        localStreamsRef.current.audio = microphoneStream;
        track.enabled = !useChordStore.getState().voiceMuted;
        startVad(microphoneStream);
        rebuildLocalStream();
      }

      setVoiceFlags({
        voiceMuted: false,
        voiceDeafened: false,
        voiceCameraOn: false,
        voiceScreenSharing: false,
        voiceQuality: { rttMs: null, state: 'connecting' },
      });
      getChordSocket()?.emit('voice:join', {
        channelId,
        serverId,
        pushToTalk: useChordStore.getState().voicePushToTalk,
      });
    },
    [cleanupAllPeers, rebuildLocalStream, refreshDevices, setVoiceFlags, setVoiceSession, startVad]
  );

  const leaveVoiceChannel = useCallback(() => {
    joinRequestRef.current += 1;
    getChordSocket()?.emit('voice:leave');
    cleanupAllPeers();
    setMicPermissionError(null);
    setVoiceSession(null, null);
  }, [cleanupAllPeers, setVoiceSession]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = enabled;
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !useChordStore.getState().voiceMuted;
    if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = !nextMuted;
    setVoiceFlags({ voiceMuted: nextMuted, voiceDeafened: nextMuted ? useChordStore.getState().voiceDeafened : false });
    getChordSocket()?.emit('voice:state', { muted: nextMuted, speaking: false });
  }, [setVoiceFlags]);

  const toggleDeafen = useCallback(() => {
    const state = useChordStore.getState();
    const nextDeafened = !state.voiceDeafened;
    if (nextDeafened) {
      preDeafenMutedRef.current = state.voiceMuted;
      if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = false;
      setVoiceFlags({ voiceDeafened: true, voiceMuted: true });
      getChordSocket()?.emit('voice:state', { deafened: true, muted: true, speaking: false });
    } else {
      const restoreMuted = preDeafenMutedRef.current;
      if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = !restoreMuted;
      setVoiceFlags({ voiceDeafened: false, voiceMuted: restoreMuted });
      getChordSocket()?.emit('voice:state', { deafened: false, muted: restoreMuted });
    }
  }, [setVoiceFlags]);

  const stopCamera = useCallback(async () => {
    localTracksRef.current.camera?.stop();
    delete localTracksRef.current.camera;
    delete localStreamsRef.current.camera;
    rebuildLocalStream();
    await syncAllPeers();
    setVoiceFlags({ voiceCameraOn: false });
    getChordSocket()?.emit('voice:state', { cameraOn: false });
  }, [rebuildLocalStream, setVoiceFlags, syncAllPeers]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError('Camera requires a secure connection (HTTPS) or localhost.');
      return false;
    }
    const preset = QUALITY_CONSTRAINTS[qualityRef.current];
    const video: MediaTrackConstraints = {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate, max: preset.frameRate },
    };
    if (selectedCameraRef.current) video.deviceId = { exact: selectedCameraRef.current };
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const track = cam.getVideoTracks()[0];
      if (!track) throw new Error('No camera track');
      track.enabled = true;
      localTracksRef.current.camera = track;
      localStreamsRef.current.camera = cam;
      track.addEventListener('ended', () => {
        void stopCamera();
      });
      rebuildLocalStream();
      await syncAllPeers();
      setVoiceFlags({ voiceCameraOn: true });
      getChordSocket()?.emit('voice:state', { cameraOn: true });
      await refreshDevices();
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      setMediaError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings.'
          : name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Could not start the camera. It may be in use by another app.'
      );
      return false;
    }
  }, [rebuildLocalStream, refreshDevices, setVoiceFlags, syncAllPeers]);

  const toggleCamera = useCallback(async () => {
    setMediaError(null);
    if (useChordStore.getState().voiceCameraOn) {
      await stopCamera();
    } else {
      await startCamera();
    }
  }, [startCamera, stopCamera]);

  const stopScreenShare = useCallback(async () => {
    const stream = localStreamsRef.current.screen;
    stream?.getTracks().forEach((track) => track.stop());
    delete localTracksRef.current.screen;
    delete localTracksRef.current.screenAudio;
    delete localStreamsRef.current.screen;
    delete localStreamsRef.current.screenAudio;
    setScreenStream(null);
    await syncAllPeers();
    setVoiceFlags({ voiceScreenSharing: false });
    getChordSocket()?.emit('voice:state', { screenSharing: false });
  }, [setVoiceFlags, syncAllPeers]);

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError('Screen sharing is not supported by this browser or requires HTTPS.');
      return false;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
      });
      const videoTrack = display.getVideoTracks()[0];
      if (!videoTrack) throw new Error('No screen track');
      localTracksRef.current.screen = videoTrack;
      localStreamsRef.current.screen = display;
      const screenAudio = display.getAudioTracks()[0];
      if (screenAudio) {
        localTracksRef.current.screenAudio = screenAudio;
        localStreamsRef.current.screenAudio = display;
      }
      videoTrack.addEventListener('ended', () => {
        void stopScreenShare();
      });
      setScreenStream(display);
      await syncAllPeers();
      setVoiceFlags({ voiceScreenSharing: true });
      getChordSocket()?.emit('voice:state', { screenSharing: true });
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name !== 'NotAllowedError') {
        setMediaError('Could not start screen sharing. Pick a window or screen to broadcast.');
      }
      return false;
    }
  }, [setVoiceFlags, stopScreenShare, syncAllPeers]);

  const toggleScreenShare = useCallback(async () => {
    setMediaError(null);
    if (useChordStore.getState().voiceScreenSharing) {
      await stopScreenShare();
    } else {
      await startScreenShare();
    }
  }, [startScreenShare, stopScreenShare]);

  const togglePushToTalk = useCallback(() => {
    const nextPtt = !useChordStore.getState().voicePushToTalk;
    if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = !nextPtt;
    setVoiceFlags({ voicePushToTalk: nextPtt, voiceMuted: nextPtt });
    getChordSocket()?.emit('voice:state', { pushToTalk: nextPtt, muted: nextPtt, speaking: false });
  }, [setVoiceFlags]);

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      writeStorage(MIC_STORAGE_KEY, deviceId);
      if (!localTracksRef.current.audio || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const audio: MediaTrackConstraints = {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: noiseSuppressionRef.current,
          autoGainControl: true,
        };
        const mic = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        const track = mic.getAudioTracks()[0];
        if (!track) return;
        track.enabled = !useChordStore.getState().voiceMuted && !useChordStore.getState().voiceDeafened;
        const old = localTracksRef.current.audio;
        localTracksRef.current.audio = track;
        localStreamsRef.current.audio = mic;
        old?.stop();
        startVad(mic);
        rebuildLocalStream();
        await syncAllPeers();
        await refreshDevices();
      } catch {
        setMediaError('Could not switch microphone. Check browser permissions.');
      }
    },
    [refreshDevices, rebuildLocalStream, startVad, syncAllPeers]
  );

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCameraId(deviceId);
      writeStorage(CAMERA_STORAGE_KEY, deviceId);
      if (!useChordStore.getState().voiceCameraOn) return;
      await stopCamera();
      await startCamera();
    },
    [startCamera, stopCamera]
  );

  const selectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    writeStorage(SPEAKER_STORAGE_KEY, deviceId);
  }, []);

  const setVideoQuality = useCallback(
    async (quality: VideoQuality) => {
      setVideoQualityState(quality);
      qualityRef.current = quality;
      writeStorage(QUALITY_STORAGE_KEY, quality);
      if (useChordStore.getState().voiceCameraOn) {
        await stopCamera();
        await startCamera();
      }
    },
    [startCamera, stopCamera]
  );

  const toggleNoiseSuppression = useCallback(async () => {
    const next = !noiseSuppressionRef.current;
    setNoiseSuppression(next);
    noiseSuppressionRef.current = next;
    if (selectedMicId) await selectMicrophone(selectedMicId);
  }, [selectMicrophone, selectedMicId]);

  const selectVoiceRelay = useCallback((preference: VoicePreference) => {
    setVoicePreference(preference);
    setVoicePreferenceState(preference);
  }, []);

  const refreshVoiceRelays = useCallback(async () => {
    setRelayProbing(true);
    try {
      const scored = await refreshVoiceNodeScores(true);
      setVoiceRelays(scored);
    } catch {
      // Discovery is best-effort; calls still fall back to server defaults.
    } finally {
      setRelayProbing(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refreshVoiceNodeScores()
        .then((scored) => {
          if (!cancelled) setVoiceRelays(scored);
        })
        .catch(() => undefined);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeVoiceChannelId || !voicePushToTalk) return;
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable));
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || e.repeat) return;
      e.preventDefault();
      if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = true;
      setVoiceFlags({ voiceMuted: false });
      getChordSocket()?.emit('voice:state', { muted: false, speaking: true });
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        if (localTracksRef.current.audio) localTracksRef.current.audio.enabled = false;
        setVoiceFlags({ voiceMuted: true });
        getChordSocket()?.emit('voice:state', { muted: true, speaking: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeVoiceChannelId, setVoiceFlags, voicePushToTalk]);

  useEffect(() => {
    const socket = getChordSocket();
    if (!socket || !user) return;

    const onPeerJoined = (payload: { userId: string; channelId: string }) => {
      if (payload.userId === user.id || payload.channelId !== channelIdRef.current) return;
      const entry = createPeerConnection(payload.userId);
      if (entry.pc.signalingState === 'stable') void sendOffer(entry);
    };

    const onOffer = async (payload: {
      fromUserId: string;
      channelId: string;
      sdp: RTCSessionDescriptionInit;
      streamMap?: Record<string, 'camera' | 'screen'>;
    }) => {
      if (payload.channelId !== channelIdRef.current || payload.fromUserId === user.id) return;
      if (payload.streamMap) remoteMetaRef.current.set(payload.fromUserId, payload.streamMap);
      const entry = createPeerConnection(payload.fromUserId);
      const pc = entry.pc;
      const readyForOffer =
        !entry.makingOffer && (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending);
      const offerCollision = !readyForOffer;
      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;

      entry.makingOffer = true;
      entry.isSettingRemoteAnswerPending = true;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushCandidates(entry);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', {
          targetUserId: payload.fromUserId,
          channelId: payload.channelId,
          sdp: pc.localDescription,
          streamMap: getStreamMap(),
        });
      } catch {
        // Offer may be stale after a reconnect.
      } finally {
        entry.makingOffer = false;
        entry.isSettingRemoteAnswerPending = false;
        if (entry.needsNegotiation && pc.signalingState === 'stable') {
          entry.needsNegotiation = false;
          void sendOffer(entry);
        }
      }
    };

    const onAnswer = async (payload: {
      fromUserId: string;
      channelId: string;
      sdp: RTCSessionDescriptionInit;
      streamMap?: Record<string, 'camera' | 'screen'>;
    }) => {
      if (payload.channelId !== channelIdRef.current || payload.fromUserId === user.id) return;
      if (payload.streamMap) remoteMetaRef.current.set(payload.fromUserId, payload.streamMap);
      const entry = peersRef.current.get(payload.fromUserId);
      if (!entry || entry.closed) return;
      try {
        if (entry.pc.signalingState === 'have-local-offer') {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushCandidates(entry);
          entry.ignoreOffer = false;
          const signalingState = entry.pc.signalingState as RTCSignalingState;
          if (entry.needsNegotiation && signalingState === 'stable') {
            entry.needsNegotiation = false;
            void sendOffer(entry);
          }
        }
      } catch {
        // ignore stale answer
      }
    };

    const onCandidate = async (payload: {
      fromUserId: string;
      channelId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (payload.channelId !== channelIdRef.current || payload.fromUserId === user.id) return;
      const entry = peersRef.current.get(payload.fromUserId);
      if (!entry || !payload.candidate) return;
      if (entry.ignoreOffer) return;
      if (!entry.pc.remoteDescription) {
        entry.pendingCandidates.push(payload.candidate);
        return;
      }
      await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    };

    const onPeerLeft = (payload: { userId: string }) => {
      const entry = peersRef.current.get(payload.userId);
      if (entry) {
        entry.closed = true;
        if (entry.disconnectTimer) window.clearTimeout(entry.disconnectTimer);
        entry.pc.close();
        peersRef.current.delete(payload.userId);
      }
      remoteMetaRef.current.delete(payload.userId);
      removeRemoteUser(payload.userId);
    };

    const onParticipants = (payload: { channelId: string; participants: Array<{ userId: string }> }) => {
      if (payload.channelId !== channelIdRef.current) return;
      for (const participant of payload.participants) {
        if (participant.userId === user.id || peersRef.current.has(participant.userId)) continue;
        const entry = createPeerConnection(participant.userId);
        if (entry.pc.signalingState === 'stable') void sendOffer(entry);
      }
    };

    const onConnect = () => {
      const channelId = channelIdRef.current;
      if (!channelId) return;
      socket.emit('voice:join', {
        channelId,
        serverId: useChordStore.getState().activeVoiceServerId,
        pushToTalk: useChordStore.getState().voicePushToTalk,
      });
      for (const entry of peersRef.current.values()) {
        if (entry.pc.signalingState === 'stable') void sendOffer(entry);
      }
    };

    socket.on('voice:peer-joined', onPeerJoined);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onCandidate);
    socket.on('voice:peer-left', onPeerLeft);
    socket.on('voice:participants', onParticipants);
    socket.on('connect', onConnect);

    return () => {
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onCandidate);
      socket.off('voice:peer-left', onPeerLeft);
      socket.off('voice:participants', onParticipants);
      socket.off('connect', onConnect);
    };
  }, [
    createPeerConnection,
    flushCandidates,
    getStreamMap,
    removeRemoteUser,
    sendOffer,
    user,
  ]);

  useEffect(() => {
    if (!activeVoiceChannelId) return;
    const interval = setInterval(async () => {
      const entries = Array.from(peersRef.current.values()).filter((entry) => !entry.closed);
      if (entries.length === 0) return;
      let bestRtt: number | null = null;
      let worstState = 'connected';
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const stats = await entry.pc.getStats();
            stats.forEach((report) => {
              if (
                report.type === 'candidate-pair' &&
                report.state === 'succeeded' &&
                typeof report.currentRoundTripTime === 'number'
              ) {
                const rtt = Math.round(report.currentRoundTripTime * 1000);
                if (bestRtt === null || rtt > bestRtt) bestRtt = rtt;
              }
            });
            if (entry.pc.connectionState !== 'connected') worstState = 'reconnecting';
          } catch {
            // ignore
          }
        })
      );
      setVoiceFlags({ voiceQuality: { rttMs: bestRtt, state: worstState } });
    }, 3000);
    return () => clearInterval(interval);
  }, [activeVoiceChannelId, setVoiceFlags]);

  // Stop all local media if the session disappears (logout / admin revoke).
  useEffect(() => {
    if (!user && activeVoiceChannelId === null) {
      cleanupAllPeers();
    }
  }, [activeVoiceChannelId, cleanupAllPeers, user]);

  useEffect(() => {
    if (voiceDeafened) {
      // Remote audio elements are muted by the UI; no local track change needed.
    }
  }, [voiceDeafened]);

  return {
    localStream,
    screenStream,
    remoteVideos,
    remoteAudioStreams,
    // Backwards-compatible alias used by older call sites.
    remoteStreams: remoteVideos,
    speakingLocal,
    audioLevel,
    micPermissionError,
    mediaError,
    clearMediaError: () => setMediaError(null),
    microphones,
    cameras,
    speakers,
    selectedMicId,
    selectedCameraId,
    selectedSpeakerId,
    videoQuality,
    noiseSuppression,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    togglePushToTalk,
    selectMicrophone,
    selectCamera,
    selectSpeaker,
    setVideoQuality,
    toggleNoiseSuppression,
    refreshDevices,
    setMicEnabled,
    voiceRelays,
    activeVoiceRelay,
    voicePreference,
    relayProbing,
    selectVoiceRelay,
    refreshVoiceRelays,
  };
}
