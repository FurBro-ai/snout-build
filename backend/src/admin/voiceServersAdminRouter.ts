import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { VoiceRegionGroup, VoiceServerNode } from '../../../shared/types.ts';
import type { AuthenticatedRequest } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';
import {
  checkAllVoiceNodes,
  checkVoiceNode,
  generateTurnSecret,
  listVoiceNodes,
  normalizeVoiceNodeInput,
} from '../voice/voiceNodeService.ts';

export const voiceServersAdminRouter = Router();

function adminNodeView(node: VoiceServerNode) {
  return {
    ...node,
    turnSecret: node.turnSecret ? `••••${node.turnSecret.slice(-4)}` : '',
    turnSecretSet: Boolean(node.turnSecret),
    turnUrls: [`turn:${node.host}:${node.turnPort}?transport=udp`, `turn:${node.host}:${node.turnPort}?transport=tcp`],
  };
}

voiceServersAdminRouter.get('/voice-servers', (_req, res) => {
  const nodes = listVoiceNodes(true).map(adminNodeView);
  const online = nodes.filter((node) => node.enabled && node.status === 'ONLINE').length;
  const degraded = nodes.filter((node) => node.enabled && node.status === 'DEGRADED').length;
  const offline = nodes.filter((node) => node.enabled && node.status === 'OFFLINE').length;
  const capacity = nodes.filter((node) => node.enabled).reduce((sum, node) => sum + node.capacity, 0);
  res.json({
    nodes,
    stats: { total: nodes.length, online, degraded, offline, capacity, enabled: nodes.filter((n) => n.enabled).length },
    regionGroups: ['oceania', 'europe', 'north-america', 'south-america', 'asia', 'africa', 'middle-east', 'global'],
  });
});

voiceServersAdminRouter.post('/voice-servers', (req: AuthenticatedRequest, res) => {
  const { errors, value } = normalizeVoiceNodeInput((req.body || {}) as Record<string, unknown>);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  if (!value.name || !value.host || !value.regionLabel || !value.regionCode || !value.regionGroup) {
    return res.status(400).json({ error: 'Name, host, region label, region code and region group are required.' });
  }
  if (dbStore.state.voiceServers.some((node) => node.host === value.host && node.turnPort === (value.turnPort || 3478))) {
    return res.status(409).json({ error: 'A voice server with this host and TURN port already exists.' });
  }

  const now = new Date().toISOString();
  const node: VoiceServerNode = {
    id: `voice-${uuidv4().slice(0, 8)}`,
    name: value.name,
    regionLabel: value.regionLabel,
    regionCode: value.regionCode,
    regionGroup: value.regionGroup as VoiceRegionGroup,
    host: value.host,
    turnPort: value.turnPort || 3478,
    tlsPort: value.tlsPort ?? null,
    stunUrls: value.stunUrls?.length ? value.stunUrls : [`stun:${value.host}:${value.turnPort || 3478}`],
    turnSecret: value.turnSecret || '',
    healthUrl: value.healthUrl ?? null,
    priority: value.priority ?? 50,
    capacity: value.capacity ?? 250,
    enabled: value.enabled ?? true,
    status: 'UNKNOWN',
    latencyMs: null,
    lastCheckedAt: null,
    notes: value.notes || '',
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.voiceServers.push(node);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SERVER_CREATED',
    targetType: 'VOICE_SERVER',
    targetId: node.id,
    details: `Added voice server "${node.name}" (${node.host}:${node.turnPort}, ${node.regionLabel})`,
  });
  dbStore.save();
  void checkVoiceNode(node).catch(() => undefined);
  res.status(201).json({ node: adminNodeView(node) });
});

voiceServersAdminRouter.patch('/voice-servers/:nodeId', (req: AuthenticatedRequest, res) => {
  const node = dbStore.state.voiceServers.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Voice server not found' });

  const { errors, value } = normalizeVoiceNodeInput((req.body || {}) as Record<string, unknown>);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  if (value.name !== undefined) node.name = value.name;
  if (value.host !== undefined) node.host = value.host;
  if (value.regionLabel !== undefined) node.regionLabel = value.regionLabel;
  if (value.regionCode !== undefined) node.regionCode = value.regionCode;
  if (value.regionGroup !== undefined) node.regionGroup = value.regionGroup;
  if (value.turnPort !== undefined) node.turnPort = value.turnPort;
  if (value.tlsPort !== undefined) node.tlsPort = value.tlsPort ?? null;
  if (value.stunUrls !== undefined) node.stunUrls = value.stunUrls.length ? value.stunUrls : node.stunUrls;
  if (value.turnSecret !== undefined) node.turnSecret = value.turnSecret;
  if (value.healthUrl !== undefined) node.healthUrl = value.healthUrl;
  if (value.priority !== undefined) node.priority = value.priority;
  if (value.capacity !== undefined) node.capacity = value.capacity;
  if (value.notes !== undefined) node.notes = value.notes;
  if (value.enabled !== undefined) node.enabled = value.enabled;

  // Keep STUN in sync when the host changes and no custom list was supplied.
  if (value.host !== undefined && value.stunUrls === undefined) {
    node.stunUrls = [`stun:${node.host}:${node.turnPort}`];
  }
  node.updatedAt = new Date().toISOString();

  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SERVER_UPDATED',
    targetType: 'VOICE_SERVER',
    targetId: node.id,
    details: `Updated voice server "${node.name}" (${node.enabled ? 'enabled' : 'disabled'}, priority ${node.priority})`,
  });
  dbStore.save();
  res.json({ node: adminNodeView(node) });
});

voiceServersAdminRouter.delete('/voice-servers/:nodeId', (req: AuthenticatedRequest, res) => {
  const node = dbStore.state.voiceServers.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Voice server not found' });
  dbStore.state.voiceServers = dbStore.state.voiceServers.filter((item) => item.id !== node.id);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SERVER_DELETED',
    targetType: 'VOICE_SERVER',
    targetId: node.id,
    details: `Removed voice server "${node.name}" (${node.host})`,
  });
  dbStore.save();
  res.json({ ok: true });
});

voiceServersAdminRouter.post('/voice-servers/:nodeId/test', async (req: AuthenticatedRequest, res) => {
  const node = dbStore.state.voiceServers.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Voice server not found' });
  const health = await checkVoiceNode(node, { markOffline: true });
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SERVER_TESTED',
    targetType: 'VOICE_SERVER',
    targetId: node.id,
    details: `Health probe for "${node.name}": ${health.detail}`,
  });
  dbStore.save();
  res.json({ health, node: adminNodeView(node) });
});

voiceServersAdminRouter.post('/voice-servers/test-all', async (req: AuthenticatedRequest, res) => {
  const results = await checkAllVoiceNodes();
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_FLEET_TESTED',
    targetType: 'VOICE_SERVER',
    targetId: 'fleet',
    details: `Health sweep across ${results.length} voice server(s) — ${results.filter((r) => r.reachable).length} reachable`,
  });
  res.json({
    results,
    nodes: listVoiceNodes(true).map(adminNodeView),
  });
});

voiceServersAdminRouter.post('/voice-servers/:nodeId/rotate-secret', (req: AuthenticatedRequest, res) => {
  const node = dbStore.state.voiceServers.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Voice server not found' });
  const secret = generateTurnSecret();
  node.turnSecret = secret;
  node.updatedAt = new Date().toISOString();
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SECRET_ROTATED',
    targetType: 'VOICE_SERVER',
    targetId: node.id,
    details: `Rotated TURN shared secret for "${node.name}". Update coturn static-auth-secret on the relay.`,
  });
  dbStore.save();
  res.json({
    node: adminNodeView(node),
    turnSecret: secret,
    instruction: `Set static-auth-secret=${secret} in /etc/turnserver.conf on ${node.host} and restart coturn.`,
  });
});

voiceServersAdminRouter.post('/voice-servers/:nodeId/duplicate', (req: AuthenticatedRequest, res) => {
  const node = dbStore.state.voiceServers.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Voice server not found' });
  const now = new Date().toISOString();
  const copy: VoiceServerNode = {
    ...node,
    id: `voice-${uuidv4().slice(0, 8)}`,
    name: `${node.name} copy`,
    enabled: false,
    status: 'UNKNOWN',
    latencyMs: null,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now,
    notes: node.notes ? `${node.notes} (copy)` : 'Copy — configure host and secret before enabling.',
  };
  dbStore.state.voiceServers.push(copy);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'ADMIN_VOICE_SERVER_DUPLICATED',
    targetType: 'VOICE_SERVER',
    targetId: copy.id,
    details: `Duplicated voice server "${node.name}" as "${copy.name}" (disabled)`,
  });
  dbStore.save();
  res.status(201).json({ node: adminNodeView(copy) });
});
