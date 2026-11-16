export const NITRO_PLAN = {
  id: 'chord_nitro_monthly',
  name: 'SNOUT NITRO',
  priceUsd: 2.00,
  formattedPrice: '$2.00 / month',
  currency: 'USD',
  interval: 'month' as const,
  durationDays: 30,
  maxUploadBytesFree: 10 * 1024 * 1024, // 10 MB
  maxUploadBytesNitro: 100 * 1024 * 1024, // 100 MB
  features: [
    {
      id: 'animated_avatar',
      title: 'Animated Profile Avatars',
      description: 'Use animated GIF or WebP avatars and luminous profile rings across every server and DM.',
    },
    {
      id: 'profile_decorations',
      title: 'Custom Profile Decorations & Banners',
      description: 'Unlock bespoke avatar frames, studio banners, and custom accent cards on your user profile.',
    },
    {
      id: 'upload_limit',
      title: '100 MB High-Resolution Uploads',
      description: 'Share lossless audio stems, 4K clips, and project archives up to 100 MB per file (10x standard limit).',
    },
    {
      id: 'custom_emojis',
      title: 'Cross-Server Custom Emojis',
      description: 'Use custom SNOUT NITRO studio emojis and server stickers in any channel or direct message.',
    },
    {
      id: 'hd_streaming',
      title: 'HD Video & 60fps Screen Share',
      description: 'Stream crisp 1080p60 screen shares and high-bitrate studio audio in voice channels.',
    },
    {
      id: 'nitro_badge',
      title: 'Official SNOUT NITRO Badge & Server Perks',
      description: 'Display the verified Nitro emblem on your profile and unlock extended server customization.',
    },
  ],
} as const;

export const PERMISSIONS = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  BAN_MEMBERS: 1 << 5,
  TIMEOUT_MEMBERS: 1 << 6,
  SEND_MESSAGES: 1 << 7,
  MANAGE_MESSAGES: 1 << 8,
  PIN_MESSAGES: 1 << 9,
  CONNECT_VOICE: 1 << 10,
  SPEAK_VOICE: 1 << 11,
  SCREEN_SHARE: 1 << 12,
  VIEW_AUDIT_LOG: 1 << 13,
  MANAGE_WEBHOOKS: 1 << 14,
  MENTION_EVERYONE: 1 << 15,
  CREATE_INVITES: 1 << 16,
  READ_MESSAGES: 1 << 17,
} as const;

export const DEFAULT_MEMBER_PERMISSIONS =
  PERMISSIONS.READ_MESSAGES |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.CONNECT_VOICE |
  PERMISSIONS.SPEAK_VOICE |
  PERMISSIONS.SCREEN_SHARE |
  PERMISSIONS.CREATE_INVITES;

export const MODERATOR_PERMISSIONS =
  DEFAULT_MEMBER_PERMISSIONS |
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.TIMEOUT_MEMBERS |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.PIN_MESSAGES |
  PERMISSIONS.VIEW_AUDIT_LOG;

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((acc, p) => acc | p, 0);

export function hasPermission(userMask: number, permission: number): boolean {
  if ((userMask & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
    return true;
  }
  return (userMask & permission) === permission;
}

export const PERMISSION_LABELS: Array<{ key: keyof typeof PERMISSIONS; flag: number; label: string; description: string }> = [
  { key: 'ADMINISTRATOR', flag: PERMISSIONS.ADMINISTRATOR, label: 'Administrator', description: 'Full access to all server settings and channels, bypassing overrides.' },
  { key: 'MANAGE_SERVER', flag: PERMISSIONS.MANAGE_SERVER, label: 'Manage Server', description: 'Edit server name, icon, banner, and discovery settings.' },
  { key: 'MANAGE_CHANNELS', flag: PERMISSIONS.MANAGE_CHANNELS, label: 'Manage Channels', description: 'Create, edit, reorder, and delete channels and categories.' },
  { key: 'MANAGE_ROLES', flag: PERMISSIONS.MANAGE_ROLES, label: 'Manage Roles', description: 'Create, edit, and assign roles below your highest role.' },
  { key: 'KICK_MEMBERS', flag: PERMISSIONS.KICK_MEMBERS, label: 'Kick Members', description: 'Remove members from the server.' },
  { key: 'BAN_MEMBERS', flag: PERMISSIONS.BAN_MEMBERS, label: 'Ban Members', description: 'Permanently ban members from rejoining.' },
  { key: 'TIMEOUT_MEMBERS', flag: PERMISSIONS.TIMEOUT_MEMBERS, label: 'Timeout Members', description: 'Temporarily mute members from sending messages or joining voice.' },
  { key: 'READ_MESSAGES', flag: PERMISSIONS.READ_MESSAGES, label: 'Read Messages', description: 'View text channels and message history.' },
  { key: 'SEND_MESSAGES', flag: PERMISSIONS.SEND_MESSAGES, label: 'Send Messages', description: 'Post messages, attachments, and embeds in text channels.' },
  { key: 'MANAGE_MESSAGES', flag: PERMISSIONS.MANAGE_MESSAGES, label: 'Manage Messages', description: 'Delete or moderate messages from other members.' },
  { key: 'PIN_MESSAGES', flag: PERMISSIONS.PIN_MESSAGES, label: 'Pin Messages', description: 'Pin and unpin messages in channels.' },
  { key: 'CONNECT_VOICE', flag: PERMISSIONS.CONNECT_VOICE, label: 'Connect to Voice', description: 'Join voice and stage channels.' },
  { key: 'SPEAK_VOICE', flag: PERMISSIONS.SPEAK_VOICE, label: 'Speak in Voice', description: 'Transmit audio in voice channels.' },
  { key: 'SCREEN_SHARE', flag: PERMISSIONS.SCREEN_SHARE, label: 'Video & Screen Share', description: 'Stream camera video and screen shares in voice channels.' },
  { key: 'VIEW_AUDIT_LOG', flag: PERMISSIONS.VIEW_AUDIT_LOG, label: 'View Audit Log', description: 'Inspect moderation and server configuration audit logs.' },
  { key: 'MANAGE_WEBHOOKS', flag: PERMISSIONS.MANAGE_WEBHOOKS, label: 'Manage Webhooks', description: 'Create and revoke channel webhooks and bot integrations.' },
  { key: 'MENTION_EVERYONE', flag: PERMISSIONS.MENTION_EVERYONE, label: 'Mention @everyone', description: 'Trigger notifications for @everyone and @here.' },
  { key: 'CREATE_INVITES', flag: PERMISSIONS.CREATE_INVITES, label: 'Create Invites', description: 'Generate invite links for this server.' },
];

export const NITRO_DECORATIONS = [
  { id: 'none', name: 'None', ringClass: '' },
  { id: 'indigo_prism', name: 'Indigo Prism', ringClass: 'ring-2 ring-[#5865F2] shadow-[0_0_16px_rgba(88,101,242,0.55)]' },
  { id: 'amber_halo', name: 'Amber Gold Halo', ringClass: 'ring-2 ring-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.5)]' },
  { id: 'emerald_pulse', name: 'Emerald Studio', ringClass: 'ring-2 ring-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.45)]' },
  { id: 'crimson_forge', name: 'Crimson Forge', ringClass: 'ring-2 ring-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.5)]' },
  { id: 'chromatic_spin', name: 'Chromatic Conic', ringClass: 'chord-animated-ring-chromatic' },
  { id: 'obsidian_halo', name: 'Obsidian Gold Pulse', ringClass: 'chord-animated-ring-gold' },
] as const;

export interface AnimatedBannerPreset {
  id: string;
  token: string;
  name: string;
  subtitle: string;
  baseGradient: string;
  accentPrimary: string;
  accentSecondary: string;
  waveStroke: string;
}

export const ANIMATED_BANNER_PRESETS: AnimatedBannerPreset[] = [
  {
    id: 'aurora_drift',
    token: 'preset:aurora_drift',
    name: 'Aurora Drift',
    subtitle: 'Acoustic Emerald & Cobalt',
    baseGradient: 'linear-gradient(125deg, #090D16 0%, #14224A 48%, #0E3A3A 100%)',
    accentPrimary: '#5865F2',
    accentSecondary: '#34D399',
    waveStroke: 'rgba(110, 231, 183, 0.55)',
  },
  {
    id: 'soundwave_horizon',
    token: 'preset:soundwave_horizon',
    name: 'Soundwave Horizon',
    subtitle: 'Indigo Harmonic Spectrum',
    baseGradient: 'linear-gradient(135deg, #0D0F18 0%, #24194D 52%, #172554 100%)',
    accentPrimary: '#818CF8',
    accentSecondary: '#C084FC',
    waveStroke: 'rgba(165, 180, 252, 0.6)',
  },
  {
    id: 'obsidian_gold',
    token: 'preset:obsidian_gold',
    name: 'Obsidian Gold',
    subtitle: 'SNOUT NITRO Signature',
    baseGradient: 'linear-gradient(130deg, #0B0C10 0%, #2B1F0E 55%, #16181F 100%)',
    accentPrimary: '#F59E0B',
    accentSecondary: '#FDE68A',
    waveStroke: 'rgba(251, 191, 36, 0.55)',
  },
  {
    id: 'prism_lattice',
    token: 'preset:prism_lattice',
    name: 'Prism Lattice',
    subtitle: 'Chromatic Glass Mesh',
    baseGradient: 'linear-gradient(135deg, #11131F 0%, #2E1065 45%, #0F4C5C 100%)',
    accentPrimary: '#38BDF8',
    accentSecondary: '#F472B6',
    waveStroke: 'rgba(56, 189, 248, 0.55)',
  },
  {
    id: 'signal_pulse',
    token: 'preset:signal_pulse',
    name: 'Signal Pulse',
    subtitle: 'Telemetry Cyan Matrix',
    baseGradient: 'linear-gradient(125deg, #060C14 0%, #0C2D48 52%, #083344 100%)',
    accentPrimary: '#06B6D4',
    accentSecondary: '#60A5FA',
    waveStroke: 'rgba(34, 211, 238, 0.58)',
  },
  {
    id: 'solar_corona',
    token: 'preset:solar_corona',
    name: 'Solar Corona',
    subtitle: 'Crimson & Amber Flare',
    baseGradient: 'linear-gradient(135deg, #14090E 0%, #4C1023 50%, #3F1D0B 100%)',
    accentPrimary: '#FB7185',
    accentSecondary: '#FB923C',
    waveStroke: 'rgba(251, 113, 133, 0.58)',
  },
];

export const NITRO_EMOJIS = [
  { code: ':snout_spark:', label: '⚡', name: 'Snout Spark' },
  { code: ':studio_crown:', label: '👑', name: 'Studio Crown' },
  { code: ':vinyl_spin:', label: '💿', name: 'Vinyl Spin' },
  { code: ':wave_crest:', label: '🌊', name: 'Wave Crest' },
  { code: ':obsidian_gem:', label: '💎', name: 'Obsidian Gem' },
  { code: ':signal_boost:', label: '📡', name: 'Signal Boost' },
] as const;
