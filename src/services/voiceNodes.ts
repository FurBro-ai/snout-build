import type { VoiceRegionGroup } from '../../shared/types.ts';
import { apiRequest } from './api.ts';

export interface VoiceNodeCandidate {
  id: string;
  name: string;
  regionLabel: string;
  regionCode: string;
  regionGroup: VoiceRegionGroup;
  host: string;
  turnPort: number;
  priority: number;
  capacity: number;
  enabled: boolean;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  latencyMs: number | null;
  lastCheckedAt: string | null;
  iceServers: RTCIceServer[];
}

export interface ScoredVoiceNode extends VoiceNodeCandidate {
  probeLatencyMs: number | null;
  probeOk: boolean;
  score: number;
}

export type VoicePreference = 'auto' | string;

const PREFERENCE_KEY = 'snout_voice_relay_preference_v1';
const PROBE_CACHE_MS = 5 * 60 * 1000;

let cachedNodes: VoiceNodeCandidate[] = [];
let cachedAt = 0;
let scoredCache: ScoredVoiceNode[] = [];

export function getVoicePreference(): VoicePreference {
  try {
    return localStorage.getItem(PREFERENCE_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

export function setVoicePreference(preference: VoicePreference) {
  try {
    if (preference === 'auto') localStorage.removeItem(PREFERENCE_KEY);
    else localStorage.setItem(PREFERENCE_KEY, preference);
  } catch {
    // storage unavailable
  }
}

export function inferRegionGroup(): VoiceRegionGroup {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/^(Australia|Pacific)\//.test(tz)) return 'oceania';
    if (/^Europe\//.test(tz)) return 'europe';
    if (/^Africa\//.test(tz)) return 'africa';
    if (/^(Asia|Indian)\//.test(tz)) {
      if (/^(Asia\/(Dubai|Riyadh|Qatar|Kuwait|Baghdad|Tehran|Jerusalem|Beirut|Amman))/.test(tz)) return 'middle-east';
      return 'asia';
    }
    if (/^America\//.test(tz)) {
      if (/^(America\/(Sao_Paulo|Argentina|Santiago|Lima|Bogota|Caracas|Montevideo|La_Paz|Asuncion|Guayaquil))/.test(tz)) {
        return 'south-america';
      }
      return 'north-america';
    }
  } catch {
    // fall through
  }
  return 'global';
}

export async function fetchVoiceNodes(force = false): Promise<VoiceNodeCandidate[]> {
  if (!force && cachedNodes.length > 0 && Date.now() - cachedAt < PROBE_CACHE_MS) {
    return cachedNodes;
  }
  const response = await fetch('/api/voice/nodes', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Voice relay discovery failed (${response.status})`);
  const payload = (await response.json()) as { nodes?: VoiceNodeCandidate[] };
  cachedNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  cachedAt = Date.now();
  scoredCache = [];
  return cachedNodes;
}

export function getCachedScoredNodes(): ScoredVoiceNode[] {
  return scoredCache;
}

export function getCachedVoiceNodes(): VoiceNodeCandidate[] {
  return cachedNodes;
}

export function probeVoiceNode(node: VoiceNodeCandidate, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let settled = false;
    const startedAt = performance.now();
    let firstCandidate: number | null = null;
    let relayCandidate: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        // ignore
      }
      const measured = relayCandidate ?? firstCandidate;
      resolve(measured === null ? null : Math.round(measured));
    };
    const timer = window.setTimeout(finish, timeoutMs);
    try {
      pc = new RTCPeerConnection({ iceServers: node.iceServers, iceCandidatePoolSize: 0 });
      pc.createDataChannel('snout-probe');
      pc.onicecandidate = (event) => {
        const candidate = event.candidate;
        if (!candidate) {
          finish();
          return;
        }
        const elapsed = performance.now() - startedAt;
        if (firstCandidate === null) firstCandidate = elapsed;
        if (candidate.type === 'relay' && relayCandidate === null) {
          relayCandidate = elapsed;
          finish();
        }
      };
      void pc
        .createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => finish());
    } catch {
      finish();
    }
  });
}

export function scoreVoiceNode(node: VoiceNodeCandidate, probeLatencyMs: number | null): number {
  const region = inferRegionGroup();
  const regionPenalty = node.regionGroup === region || node.regionGroup === 'global' ? 0 : 35;
  const healthPenalty = node.status === 'OFFLINE' ? 600 : node.status === 'DEGRADED' ? 90 : node.status === 'UNKNOWN' ? 20 : 0;
  const base = probeLatencyMs ?? (node.latencyMs ?? 180) + 120;
  return base + regionPenalty + healthPenalty + node.priority * 0.4;
}

export async function refreshVoiceNodeScores(force = false): Promise<ScoredVoiceNode[]> {
  const nodes = (await fetchVoiceNodes(force)).filter((node) => node.enabled);
  const probes = await Promise.all(
    nodes.map(async (node) => {
      const latency = await probeVoiceNode(node);
      return { node, latency };
    })
  );
  scoredCache = probes
    .map(({ node, latency }) => ({
      ...node,
      probeLatencyMs: latency,
      probeOk: latency !== null,
      score: scoreVoiceNode(node, latency),
    }))
    .sort((a, b) => a.score - b.score);

  void Promise.allSettled(
    probes.map(({ node, latency }) =>
      apiRequest('/api/voice/nodes/report', {
        method: 'POST',
        body: JSON.stringify({ nodeId: node.id, latencyMs: latency, ok: latency !== null }),
      })
    )
  );

  return scoredCache;
}

export function pickVoiceNodeForJoin(preference: VoicePreference = getVoicePreference()): string | null {
  if (preference !== 'auto') {
    const manual = cachedNodes.find((node) => node.id === preference && node.enabled);
    if (manual) return manual.id;
  }
  if (scoredCache.length > 0) return scoredCache[0].id;
  const enabled = cachedNodes.filter((node) => node.enabled);
  if (enabled.length === 0) return null;
  const region = inferRegionGroup();
  return (
    enabled.find((node) => node.regionGroup === region)?.id ||
    [...enabled].sort((a, b) => a.priority - b.priority)[0]?.id ||
    null
  );
}
