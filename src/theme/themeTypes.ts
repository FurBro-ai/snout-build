/**
 * Snout theme model
 * ------------------------------------------------------------------
 * A theme is a portable, serialisable object. Colour tokens live under
 * `colors`; layout/feel tokens live at the top level. Keeping the shape
 * flat and JSON-safe makes export/import and localStorage persistence
 * straightforward.
 */

export type ThemeMode = 'dark' | 'light';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type BackgroundStyle = 'solid' | 'gradient' | 'mesh';

export const THEME_STORAGE_KEY = 'snout_theme_v1';
export const THEME_EXPORT_FORMAT = 'snout-theme';
export const THEME_EXPORT_VERSION = 1;

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.2;
export const DEFAULT_FONT_SCALE = 1;

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 20;
export const DEFAULT_RADIUS = 12;

export const THEME_COLOR_KEYS = [
  'background',
  'surface',
  'panel',
  'elevated',
  'hover',
  'text',
  'textMuted',
  'accent',
  'accentHover',
  'accentText',
  'border',
  'success',
  'danger',
  'warning',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;

export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = {
  background: 'Background',
  surface: 'Surface',
  panel: 'Panel',
  elevated: 'Elevated',
  hover: 'Hover',
  text: 'Text',
  textMuted: 'Muted text',
  accent: 'Accent',
  accentHover: 'Accent hover',
  accentText: 'Text on accent',
  border: 'Border',
  success: 'Success',
  danger: 'Danger',
  warning: 'Warning',
};

/** The eight tokens surfaced in the main picker grid. */
export const PRIMARY_COLOR_KEYS: ThemeColorKey[] = [
  'background',
  'surface',
  'panel',
  'elevated',
  'accent',
  'accentHover',
  'text',
  'textMuted',
];

export const ADVANCED_COLOR_KEYS: ThemeColorKey[] = [
  'hover',
  'accentText',
  'border',
  'success',
  'danger',
  'warning',
];

export const DENSITY_LABELS: Record<ThemeDensity, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  spacious: 'Spacious',
};

export const BACKGROUND_STYLE_LABELS: Record<BackgroundStyle, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  mesh: 'Mesh',
};

export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: ThemeMode;
  colors: ThemeColors;
  /** 0.85 – 1.2 */
  fontScale: number;
  /** 0 – 20px */
  radius: number;
  density: ThemeDensity;
  reduceMotion: boolean;
  backgroundStyle: BackgroundStyle;
  gradientFrom?: string;
  gradientTo?: string;
}

/** A bundled preset additionally carries the swatch strip shown in the gallery. */
export interface ThemePreset extends Theme {
  swatches: string[];
}

/** Partial update accepted by the store's `setTheme` action. */
export interface ThemePatch {
  id?: string;
  name?: string;
  description?: string;
  mode?: ThemeMode;
  colors?: Partial<ThemeColors>;
  fontScale?: number;
  radius?: number;
  density?: ThemeDensity;
  reduceMotion?: boolean;
  backgroundStyle?: BackgroundStyle;
  gradientFrom?: string;
  gradientTo?: string;
}

/** Shape written to localStorage under `snout_theme_v1`. */
export interface PersistedThemeState {
  version: number;
  theme: Theme;
  activePresetId: string | null;
  customThemes: Theme[];
}

export type ThemeImportResult =
  | { ok: true; theme: Theme }
  | { ok: false; error: string };

export function isThemeDensity(value: unknown): value is ThemeDensity {
  return value === 'compact' || value === 'comfortable' || value === 'spacious';
}

export function isBackgroundStyle(value: unknown): value is BackgroundStyle {
  return value === 'solid' || value === 'gradient' || value === 'mesh';
}
