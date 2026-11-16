import type { VoiceServerNode, VoiceRegionGroup } from '../../../shared/types.ts';

/**
 * Fleet seed. Two relays are provisioned today:
 *   1. Sydney, Australia  — primary application + relay host (95.111.216.126)
 *   2. Stockholm, Sweden  — dedicated relay node            (16.16.120.220)
 *
 * Additional nodes (US, Asia, South America, …) are added from
 * Admin Console → Voice Servers and auto-selected by client latency.
 *
 * Secrets are read from the environment at boot. On a fresh install the
 * defaults are persisted into the store, after which the admin console is the
 * source of truth (secrets can be rotated per node).
 */
export function createDefaultVoiceServers(): VoiceServerNode[] {
  const now = new Date().toISOString();
  const sharedSecret = process.env.TURN_SECRET || '';
  const secondSecret = process.env.TURN_SECRET_2 || sharedSecret;

  const seed = (
    partial: Pick<VoiceServerNode, 'id' | 'name' | 'regionLabel' | 'regionCode' | 'regionGroup' | 'host' | 'priority' | 'notes'> & {
      secret: string;
      healthUrl?: string | null;
    }
  ): VoiceServerNode => ({
    id: partial.id,
    name: partial.name,
    regionLabel: partial.regionLabel,
    regionCode: partial.regionCode,
    regionGroup: partial.regionGroup as VoiceRegionGroup,
    host: partial.host,
    turnPort: 3478,
    tlsPort: null,
    stunUrls: [`stun:${partial.host}:3478`],
    turnSecret: partial.secret,
    healthUrl: partial.healthUrl ?? null,
    priority: partial.priority,
    capacity: 250,
    enabled: true,
    status: 'UNKNOWN',
    latencyMs: null,
    lastCheckedAt: null,
    notes: partial.notes,
    createdAt: now,
    updatedAt: now,
  });

  return [
    seed({
      id: 'voice-syd-1',
      name: 'Sydney Edge',
      regionLabel: 'Sydney, Australia',
      regionCode: 'au-syd',
      regionGroup: 'oceania',
      host: '95.111.216.126',
      priority: 10,
      secret: sharedSecret,
      healthUrl: `${(process.env.APP_URL || 'https://snout.cloud').replace(/\/+$/, '')}/api/health`,
      notes: 'Primary application host and TURN relay for Oceania. Runs coturn on UDP/TCP 3478.',
    }),
    seed({
      id: 'voice-sto-2',
      name: 'Stockholm Relay',
      regionLabel: 'Stockholm, Sweden',
      regionCode: 'eu-sto',
      regionGroup: 'europe',
      host: '16.16.120.220',
      priority: 20,
      secret: secondSecret,
      notes: 'Dedicated coturn relay in AWS eu-north-1 for Europe, Middle East and Africa.',
    }),
  ];
}
