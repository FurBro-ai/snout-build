import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, exportTheme, parseThemeImport, updateThemeColor } from '../src/theme/themeStore.ts';
import { sanitizeCustomSoundCue } from '../shared/soundboard.ts';

describe('theme import and export', () => {
  it('round-trips an exported theme with a fresh custom id', () => {
    const imported = parseThemeImport(exportTheme(DEFAULT_THEME));
    expect(imported.name).toBe(DEFAULT_THEME.name);
    expect(imported.colors.background).toBe(DEFAULT_THEME.colors.background);
    expect(imported.id).not.toBe(DEFAULT_THEME.id);
  });

  it('rejects unsupported or malformed theme files', () => {
    expect(() => parseThemeImport('{"format":"other","version":1,"theme":{}}')).toThrow();
    const malformed = { ...DEFAULT_THEME, radius: 500 };
    expect(() => parseThemeImport(JSON.stringify({ format: 'snout-theme', version: 1, theme: malformed }))).toThrow();
  });

  it('accepts valid hex updates and ignores invalid colors', () => {
    expect(updateThemeColor(DEFAULT_THEME, 'accent', '#123456').colors.accent).toBe('#123456');
    expect(updateThemeColor(DEFAULT_THEME, 'accent', 'red')).toBe(DEFAULT_THEME);
  });
});

describe('custom soundboard cues', () => {
  it('accepts a short valid cue and rejects oversized or unsafe notes', () => {
    const cue = { id: 'custom-1', name: 'Signal', notes: [{ frequency: 440, durationMs: 300 }] };
    expect(sanitizeCustomSoundCue(cue)).toEqual(cue);
    expect(sanitizeCustomSoundCue({ ...cue, notes: Array(9).fill(cue.notes[0]) })).toBeNull();
    expect(sanitizeCustomSoundCue({ ...cue, notes: [{ frequency: 24000, durationMs: 300 }] })).toBeNull();
  });
});