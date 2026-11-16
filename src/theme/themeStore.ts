import {
  DEFAULT_FONT_SCALE,
  DEFAULT_RADIUS,
  THEME_COLOR_KEYS,
  THEME_EXPORT_FORMAT,
  THEME_EXPORT_VERSION,
  THEME_STORAGE_KEY,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  isBackgroundStyle,
  isThemeDensity,
  type PersistedThemeState,
  type Theme,
  type ThemeColorKey,
  type ThemeMode,
} from './themeTypes.ts';

const DEFAULT_COLORS = {
  background: '#0D0F12',
  surface: '#12151A',
  panel: '#171A21',
  elevated: '#1E222B',
  hover: '#262B36',
  text: '#F1F3F5',
  textMuted: '#94A3B8',
  accent: '#5865F2',
  accentHover: '#4752C4',
  accentText: '#FFFFFF',
  border: '#343A46',
  success: '#34D399',
  danger: '#F43F5E',
  warning: '#FBBF24',
} as const;

export const DEFAULT_THEME: Theme = {
  id: 'default-dark',
  name: 'Midnight Studio',
  description: 'The original Snout dark palette.',
  mode: 'dark',
  colors: { ...DEFAULT_COLORS },
  fontScale: DEFAULT_FONT_SCALE,
  radius: DEFAULT_RADIUS,
  density: 'comfortable',
  reduceMotion: false,
  backgroundStyle: 'solid',
};

export const THEME_PRESETS: Theme[] = [
  DEFAULT_THEME,
  {
    ...DEFAULT_THEME,
    id: 'paper-citrus',
    name: 'Paper & Citrus',
    description: 'A bright neutral canvas with a sharp green signal.',
    mode: 'light',
    colors: {
      ...DEFAULT_COLORS,
      background: '#F4F5F2',
      surface: '#FFFFFF',
      panel: '#E8EBE5',
      elevated: '#DDE2DA',
      hover: '#D1D8CE',
      text: '#18211C',
      textMuted: '#64736A',
      accent: '#167A55',
      accentHover: '#105F41',
      accentText: '#FFFFFF',
      border: '#C8D0C8',
    },
  },
  {
    ...DEFAULT_THEME,
    id: 'ember-signal',
    name: 'Ember Signal',
    description: 'Warm surfaces balanced with cool mint accents.',
    colors: {
      ...DEFAULT_COLORS,
      background: '#171413',
      surface: '#211C19',
      panel: '#2A2420',
      elevated: '#38302A',
      hover: '#463A31',
      text: '#F4EEE8',
      textMuted: '#B9A99B',
      accent: '#62C7A5',
      accentHover: '#43A988',
      accentText: '#10251E',
      border: '#59483D',
    },
  },
];

const VALID_HEX = /^#[\da-f]{6}$/i;
const TOKEN_MAP: Record<ThemeColorKey, string> = {
  background: '--color-background',
  surface: '--color-card',
  panel: '--color-popover',
  elevated: '--color-secondary',
  hover: '--color-accent',
  text: '--color-foreground',
  textMuted: '--color-muted-foreground',
  accent: '--color-primary',
  accentHover: '--snout-accent-hover',
  accentText: '--color-primary-foreground',
  border: '--snout-border',
  success: '--snout-success',
  danger: '--color-destructive',
  warning: '--snout-warning',
};

function validTheme(value: unknown): value is Theme {
  if (!value || typeof value !== 'object') return false;
  const theme = value as Partial<Theme>;
  if (
    typeof theme.id !== 'string' ||
    theme.id.length > 100 ||
    typeof theme.name !== 'string' ||
    !theme.name.trim() ||
    theme.name.length > 40 ||
    typeof theme.description !== 'string' ||
    !theme.colors ||
    (theme.mode !== 'dark' && theme.mode !== 'light') ||
    !isThemeDensity(theme.density) ||
    !isBackgroundStyle(theme.backgroundStyle) ||
    typeof theme.fontScale !== 'number' ||
    !Number.isFinite(theme.fontScale) ||
    theme.fontScale < FONT_SCALE_MIN ||
    theme.fontScale > FONT_SCALE_MAX ||
    typeof theme.radius !== 'number' ||
    !Number.isFinite(theme.radius) ||
    theme.radius < RADIUS_MIN ||
    theme.radius > RADIUS_MAX ||
    typeof theme.reduceMotion !== 'boolean'
  ) return false;
  return THEME_COLOR_KEYS.every((key) => typeof theme.colors?.[key] === 'string' && VALID_HEX.test(theme.colors[key]));
}

export function readThemeState(): PersistedThemeState {
  if (typeof localStorage === 'undefined') {
    return { version: THEME_EXPORT_VERSION, theme: DEFAULT_THEME, activePresetId: DEFAULT_THEME.id, customThemes: [] };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || 'null') as Partial<PersistedThemeState> | null;
    return {
      version: THEME_EXPORT_VERSION,
      theme: validTheme(saved?.theme) ? saved.theme : DEFAULT_THEME,
      activePresetId: typeof saved?.activePresetId === 'string' ? saved.activePresetId : DEFAULT_THEME.id,
      customThemes: Array.isArray(saved?.customThemes) ? saved.customThemes.filter(validTheme) : [],
    };
  } catch {
    return { version: THEME_EXPORT_VERSION, theme: DEFAULT_THEME, activePresetId: DEFAULT_THEME.id, customThemes: [] };
  }
}

export function saveThemeState(state: PersistedThemeState): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
  applyTheme(state.theme);
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of THEME_COLOR_KEYS) root.style.setProperty(TOKEN_MAP[key], theme.colors[key]);
  root.dataset.themeMode = theme.mode satisfies ThemeMode;
  root.dataset.themeDensity = theme.density;
  root.style.setProperty('--snout-radius', `${theme.radius}px`);
  root.style.setProperty('--spacing', `${theme.density === 'compact' ? 0.2 : theme.density === 'spacious' ? 0.3 : 0.25}rem`);
  root.style.setProperty('--snout-font-scale', String(theme.fontScale));
  root.classList.toggle('dark', theme.mode === 'dark');
  document.body.style.backgroundColor = theme.colors.background;
}

export function applySavedTheme(): void {
  applyTheme(readThemeState().theme);
}

export function parseThemeImport(text: string): Theme {
  const parsed = JSON.parse(text) as { format?: string; version?: number; theme?: unknown };
  const theme = parsed?.theme;
  if (parsed?.format !== THEME_EXPORT_FORMAT || parsed.version !== THEME_EXPORT_VERSION || !validTheme(theme)) {
    throw new Error('This file is not a supported Snout theme export.');
  }
  return { ...theme, id: `custom-${crypto.randomUUID()}` };
}

export function exportTheme(theme: Theme): string {
  return JSON.stringify({ format: THEME_EXPORT_FORMAT, version: THEME_EXPORT_VERSION, theme }, null, 2);
}

export function updateThemeColor(theme: Theme, key: ThemeColorKey, color: string): Theme {
  if (!VALID_HEX.test(color)) return theme;
  return { ...theme, colors: { ...theme.colors, [key]: color } };
}