import net from 'net';
import { createHmac, randomBytes } from 'crypto';
import type {
  PublicVoiceServerNode,
  VoiceNodeHealth,
  VoiceRegionGroup,
  VoiceServerNode,
} from '../../../shared/types.ts';
import { dbStore } from '../store/dbStore.ts';

export const VOICE_REGION_GROUPS: VoiceRegionGroup[] = [
  'oceania',
  'europe',
  'north-america',
  'south-america',
  'asia',
  'africa',
  'middle-east',
  'global',
];

const TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

export function listVoiceNodes(includeDisabled = false): VoiceServerNode[] {
  return dbStore.state.voiceServers
    .filter((node) => includeDisabled || node.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function findVoiceNode(nodeId: string): VoiceServerNode | null {
  return dbStore.state.voiceServers.find((node) => node.id === nodeId) || null;
}

export function buildTurnUrls(node: VoiceServerNode): string[] {
  const urls = [
    `turn:${node.host}:${node.turnPort}?transport=udp`,
    `turn:${node.host}:${node.turnPort}?transport=tcp`,
  ];
  if (node.tlsPort) urls.push(`turns:${node.host}:${node.tlsPort}?transport=tcp`);
  return urls;
}

export function buildIceServers(node: VoiceServerNode, userId: string): RTCIceServer[] {
  const iceServers: RTCIceServer[] = (node.stunUrls?.length ? node.stunUrls : [`stun:${node.host}:${node.turnPort}`]).map(
    (urls) => ({ urls })
  );
  if (node.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:${userId}`;
    const credential = createHmac('sha1', node.turnSecret).update(username).digest('base64');
    iceServers.push({ urls: buildTurnUrls(node), username, credential });
  }
  return iceServers;
}

export function toPublicVoiceNode(node: VoiceServerNode, userId: string): PublicVoiceServerNode {
  return {
    id: node.id,
    name: node.name,
    regionLabel: node.regionLabel,
    regionCode: node.regionCode,
    regionGroup: node.regionGroup,
    host: node.host,
    turnPort: node.turnPort,
    priority: node.priority,
    capacity: node.capacity,
    enabled: node.enabled,
    status: node.status,
    latencyMs: node.latencyMs,
    lastCheckedAt: node.lastCheckedAt,
    lastClientReportAt: node.lastClientReportAt || null,
    iceServers: buildIceServers(node, userId),
  };
}

/** Preferred node when the browser has not measured its own latency yet. */
export function pickPreferredVoiceNode(nodes: VoiceServerNode[]): VoiceServerNode | null {
  const ranked = nodes
    .filter((node) => node.enabled)
    .slice()
    .sort((a, b) => {
      const statusWeight = (node: VoiceServerNode) =>
        node.status === 'ONLINE' ? 0 : node.status === 'DEGRADED' ? 1 : node.status === 'UNKNOWN' ? 2 : 3;
      const latency = (node: VoiceServerNode) =>
        node.latencyMs === null ? 250 : Math.min(node.latencyMs, 1000);
      return (
        statusWeight(a) - statusWeight(b) ||
        latency(a) - latency(b) ||
        a.priority - b.priority ||
        a.name.localeCompare(b.name)
      );
    });
  return ranked[0] || null;
}

/** Resolve ICE config for a specific node (or the server's best guess). */
export function getIceConfigForUser(
  userId: string,
  nodeId?: string
): { iceServers: RTCIceServer[]; node: PublicVoiceServerNode | null } {
  const requested = nodeId ? findVoiceNode(nodeId) : null;
  const node = requested?.enabled ? requested : pickPreferredVoiceNode(listVoiceNodes());
  if (node) {
    return { iceServers: buildIceServers(node, userId), node: toPublicVoiceNode(node, userId) };
  }
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    node: null,
  };
}

/* ------------------------------------------------------------------ */
/* Health probes                                                       */
/* ------------------------------------------------------------------ */

function probeTcp(host: string, port: number, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Math.round(performance.now() - startedAt));
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error(`Timed out after ${timeoutMs}ms`)));
    socket.once('error', (err) => finish(err));
    try {
      socket.connect({ host, port });
    } catch (err) {
      finish(err as Error);
    }
  });
}

export async function checkVoiceNode(
  node: VoiceServerNode,
  options: { markOffline?: boolean } = {}
): Promise<VoiceNodeHealth> {
  const checkedAt = new Date().toISOString();
  let tcpLatency: number | null = null;
  let tcpError = '';
  try {
    tcpLatency = await probeTcp(node.host, node.turnPort);
  } catch (err) {
    tcpError = (err as Error).message;
  }

  let httpDetail = '';
  let httpOk: boolean | null = null;
  if (node.healthUrl) {
    const startedAt = performance.now();
    try {
      const response = await fetch(node.healthUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      httpOk = response.ok;
      httpDetail = `health ${response.status} in ${Math.round(performance.now() - startedAt)}ms`;
    } catch (err) {
      httpOk = false;
      httpDetail = `health probe failed: ${(err as Error).message}`;
    }
  }

  const reachable = tcpLatency !== null;
  const latencyMs = tcpLatency !== null ? tcpLatency : null;
  if (reachable) {
    node.status = latencyMs !== null && latencyMs > 400 ? 'DEGRADED' : 'ONLINE';
    node.latencyMs = latencyMs;
    node.lastCheckedAt = checkedAt;
  } else if (options.markOffline) {
    node.status = 'OFFLINE';
    node.latencyMs = null;
    node.lastCheckedAt = checkedAt;
  }
  node.updatedAt = checkedAt;
  dbStore.save();

  const detailParts = [
    reachable ? `TURN TCP ${node.host}:${node.turnPort} reachable in ${latencyMs}ms` : `TURN TCP unreachable: ${tcpError || 'unknown error'}`,
    httpDetail,
  ].filter(Boolean);

  return {
    nodeId: node.id,
    reachable,
    latencyMs,
    checkedAt,
    detail: detailParts.join(' · '),
  };
}

export async function checkAllVoiceNodes(): Promise<VoiceNodeHealth[]> {
  const nodes = listVoiceNodes(true);
  const results = await Promise.all(nodes.map((node) => checkVoiceNode(node)));
  dbStore.save();
  return results;
}

let monitorTimer: NodeJS.Timeout | null = null;

/** Periodically refreshes relay health. Safe to call more than once. */
export function startVoiceNodeMonitor(intervalMs = 4 * 60 * 1000): void {
  if (monitorTimer || process.env.VERCEL) return;
  const run = () => {
    void checkAllVoiceNodes().catch((err) => {
      console.warn('[voice] relay health sweep failed:', (err as Error).message);
    });
  };
  const initial = setTimeout(run, 8_000);
  initial.unref?.();
  monitorTimer = setInterval(run, intervalMs);
  monitorTimer.unref?.();
}

export function generateTurnSecret(): string {
  return randomBytes(32).toString('hex');
}

const reportThrottle = new Map<string, number>();

/**
 * Records a real client-side ICE probe. Clients are the best judge of relay
 * reachability because their network path is the one that matters.
 */
export function reportVoiceNodeHealth(
  nodeId: string,
  userId: string,
  latencyMs: number | null,
  ok: boolean
): { accepted: boolean; node?: VoiceServerNode } {
  const throttleKey = `${userId}:${nodeId}`;
  const last = reportThrottle.get(throttleKey) || 0;
  const nowMs = Date.now();
  if (nowMs - last < 15_000) return { accepted: false };
  reportThrottle.set(throttleKey, nowMs);
  if (reportThrottle.size > 5000) reportThrottle.clear();

  const node = findVoiceNode(nodeId);
  if (!node) return { accepted: false };

  const checkedAt = new Date().toISOString();
  node.lastClientReportAt = checkedAt;
  node.lastCheckedAt = checkedAt;
  if (ok && latencyMs !== null && Number.isFinite(latencyMs)) {
    node.latencyMs = Math.max(1, Math.round(latencyMs));
    node.status = node.latencyMs > 400 ? 'DEGRADED' : 'ONLINE';
  } else if (node.status !== 'ONLINE') {
    node.status = 'OFFLINE';
  }
  node.updatedAt = checkedAt;
  dbStore.save();
  return { accepted: true, node };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function normalizeVoiceNodeInput(body: Record<string, unknown>) {
  const errors: string[] = [];
  const string = (key: string) => (body[key] === undefined || body[key] === null ? undefined : String(body[key]).trim());

  const name = string('name');
  if (name !== undefined && (name.length < 2 || name.length > 64)) errors.push('Name must be 2-64 characters.');

  const host = string('host');
  if (host !== undefined && !HOST_RE.test(host)) errors.push('Host must be a valid hostname or IP address.');

  const regionLabel = string('regionLabel');
  if (regionLabel !== undefined && (regionLabel.length < 2 || regionLabel.length > 80)) {
    errors.push('Region label must be 2-80 characters.');
  }

  const regionCode = string('regionCode');
  if (regionCode !== undefined && !/^[a-z0-9-]{2,24}$/.test(regionCode)) {
    errors.push('Region code must be 2-24 lowercase letters, numbers or dashes.');
  }

  const regionGroup = string('regionGroup');
  if (regionGroup !== undefined && !VOICE_REGION_GROUPS.includes(regionGroup as VoiceRegionGroup)) {
    errors.push(`Region group must be one of: ${VOICE_REGION_GROUPS.join(', ')}.`);
  }

  const turnPort = body.turnPort === undefined ? undefined : Number(body.turnPort);
  if (turnPort !== undefined && (!Number.isInteger(turnPort) || turnPort < 1 || turnPort > 65535)) {
    errors.push('TURN port must be between 1 and 65535.');
  }

  const tlsPort =
    body.tlsPort === undefined || body.tlsPort === null || body.tlsPort === ''
      ? undefined
      : Number(body.tlsPort);
  if (tlsPort !== undefined && (!Number.isInteger(tlsPort) || tlsPort < 1 || tlsPort > 65535)) {
    errors.push('TLS port must be between 1 and 65535.');
  }

  const priority = body.priority === undefined ? undefined : Number(body.priority);
  if (priority !== undefined && (!Number.isFinite(priority) || priority < 0 || priority > 999)) {
    errors.push('Priority must be between 0 and 999.');
  }

  const capacity = body.capacity === undefined ? undefined : Number(body.capacity);
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) {
    errors.push('Capacity must be between 1 and 100000.');
  }

  let stunUrls: string[] | undefined;
  if (body.stunUrls !== undefined) {
    const raw = Array.isArray(body.stunUrls) ? body.stunUrls : String(body.stunUrls).split(',');
    stunUrls = raw
      .map((url) => String(url).trim())
      .filter(Boolean)
      .filter((url) => /^stuns?:[a-zA-Z0-9.\-[\]:_]+$/i.test(url));
    if (stunUrls.length > 8) errors.push('At most 8 STUN URLs are allowed.');
  }

  const healthUrl = string('healthUrl');
  if (healthUrl && !/^https?:\/\/[^\s]+$/i.test(healthUrl)) {
    errors.push('Health URL must start with http:// or https://.');
  }

  const notes = string('notes');
  if (notes !== undefined && notes.length > 500) errors.push('Notes must be 500 characters or fewer.');

  return {
    errors,
    value: {
      name,
      host,
      regionLabel,
      regionCode,
      regionGroup: regionGroup as VoiceRegionGroup | undefined,
      turnPort,
      tlsPort,
      priority,
      capacity,
      stunUrls,
      healthUrl: healthUrl === '' ? null : healthUrl,
      notes,
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      turnSecret:
        body.turnSecret === undefined || String(body.turnSecret).startsWith('••')
          ? undefined
          : String(body.turnSecret).trim(),
    },
  };
}
