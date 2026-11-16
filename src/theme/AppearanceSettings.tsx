import React, { useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import {
  ADVANCED_COLOR_KEYS,
  DENSITY_LABELS,
  PRIMARY_COLOR_KEYS,
  THEME_COLOR_LABELS,
  type PersistedThemeState,
  type Theme,
  type ThemeColorKey,
} from './themeTypes.ts';
import { DEFAULT_THEME, THEME_PRESETS, exportTheme, parseThemeImport, readThemeState, saveThemeState, updateThemeColor } from './themeStore.ts';
import { setLocale, translate, useLocale, type Locale, type TranslationKey } from '../i18n.ts';

export const AppearanceSettings: React.FC = () => {
  const [state, setState] = useState<PersistedThemeState>(readThemeState);
  const locale = useLocale();
  const tx = (key: TranslationKey) => translate(key, locale);
  const [status, setStatus] = useState('');
  const theme = state.theme;

  const commit = (next: PersistedThemeState) => {
    setState(next);
    saveThemeState(next);
  };

  const update = (patch: Partial<Theme>) => commit({ ...state, theme: { ...theme, ...patch }, activePresetId: null });
  const setColor = (key: ThemeColorKey, color: string) => updateThemeColor(theme, key, color) !== theme &&
    commit({ ...state, theme: updateThemeColor(theme, key, color), activePresetId: null });

  const saveCustom = () => {
    const custom = { ...theme, id: `custom-${crypto.randomUUID()}` };
    commit({ ...state, theme: custom, activePresetId: custom.id, customThemes: [...state.customThemes.filter((item) => item.name !== custom.name), custom] });
    setStatus(tx('savedTheme'));
  };

  const downloadTheme = () => {
    const url = URL.createObjectURL(new Blob([exportTheme(theme)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.snout-theme.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTheme = async (file?: File) => {
    if (!file) return;
    try {
      const imported = parseThemeImport(await file.text());
      commit({ ...state, theme: imported, activePresetId: imported.id, customThemes: [...state.customThemes, imported] });
      setStatus(tx('importedTheme'));
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const changeLocale = (value: Locale) => {
    setLocale(value);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white">{tx('language')}</h3>
        <div className="inline-flex rounded-lg border border-white/10 bg-[#0D0F12] p-1">
          {([['en', 'English'], ['ru', 'Русский']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => changeLocale(value)} aria-pressed={locale === value}
              className={`rounded-md px-3 py-1.5 text-xs ${locale === value ? 'bg-[#262B36] text-white' : 'text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">{tx('themes')}</h3>
            <p className="mt-1 text-xs text-slate-400">{tx('themeDescription')}</p>
          </div>
          <button type="button" onClick={() => commit({ ...state, theme: { ...DEFAULT_THEME }, activePresetId: DEFAULT_THEME.id })}
            title={tx('resetTheme')} aria-label={tx('resetTheme')} className="rounded-md p-2 text-slate-400 hover:bg-white/10 hover:text-white">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_PRESETS.map((preset) => (
            <button key={preset.id} type="button" onClick={() => commit({ ...state, theme: { ...preset, colors: { ...preset.colors } }, activePresetId: preset.id })}
              aria-pressed={state.activePresetId === preset.id}
              className={`flex items-center gap-2 rounded-md border p-2 text-left ${state.activePresetId === preset.id ? 'border-emerald-400' : 'border-white/10 hover:border-white/25'}`}>
              <span className="flex h-7 w-10 shrink-0 overflow-hidden rounded-sm">
                {[preset.colors.background, preset.colors.surface, preset.colors.accent].map((color) => <i key={color} className="flex-1" style={{ backgroundColor: color }} />)}
              </span>
              <span className="min-w-0 truncate text-xs text-white">{preset.name}</span>
            </button>
          ))}
          {state.customThemes.map((custom) => (
            <button key={custom.id} type="button" onClick={() => commit({ ...state, theme: custom, activePresetId: custom.id })}
              className={`rounded-md border p-2 text-left text-xs ${state.activePresetId === custom.id ? 'border-emerald-400' : 'border-white/10 hover:border-white/25'}`}>
              <span className="block truncate text-white">{custom.name}</span>
              <span className="mt-1 block truncate text-slate-500">{tx('custom')}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <label className="block space-y-1 text-xs">
          <span className="text-slate-300">{tx('themeName')}</span>
          <input value={theme.name} onChange={(event) => update({ name: event.target.value })} maxLength={40}
            className="w-full max-w-sm rounded-md border border-white/10 bg-[#0D0F12] px-3 py-2 text-white" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRIMARY_COLOR_KEYS.map((key) => <ColorControl key={key} colorKey={key} theme={theme} onChange={setColor} />)}
        </div>
        <details className="rounded-md border border-white/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">{tx('advancedColors')}</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ADVANCED_COLOR_KEYS.map((key) => <ColorControl key={key} colorKey={key} theme={theme} onChange={setColor} />)}
          </div>
        </details>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-slate-300">{tx('mode')}
            <select value={theme.mode} onChange={(event) => update({ mode: event.target.value as Theme['mode'] })} className="block w-full rounded-md border border-white/10 bg-[#0D0F12] px-2 py-2 text-white">
              <option value="dark">{tx('dark')}</option><option value="light">{tx('light')}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-300">{tx('density')}
            <select value={theme.density} onChange={(event) => update({ density: event.target.value as Theme['density'] })} className="block w-full rounded-md border border-white/10 bg-[#0D0F12] px-2 py-2 text-white">
              {Object.entries(DENSITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-300">{tx('radius')} · {theme.radius}px
            <input type="range" min="0" max="20" value={theme.radius} onChange={(event) => update({ radius: Number(event.target.value) })} className="block w-full accent-emerald-400" />
          </label>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <button type="button" onClick={saveCustom} className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">{tx('saveTheme')}</button>
        <button type="button" onClick={downloadTheme} title={tx('exportTheme')} aria-label={tx('exportTheme')} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10"><Download className="h-4 w-4" /></button>
        <label title={tx('importTheme')} aria-label={tx('importTheme')} className="cursor-pointer rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10">
          <Upload className="h-4 w-4" /><input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { void importTheme(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </label>
        {status && <span role="status" className="text-xs text-slate-400">{status}</span>}
      </section>
    </div>
  );
};

function ColorControl({ colorKey, theme, onChange }: { colorKey: ThemeColorKey; theme: Theme; onChange: (key: ThemeColorKey, color: string) => void }) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5 text-xs text-slate-300">
      <span className="truncate">{THEME_COLOR_LABELS[colorKey]}</span>
      <span className="flex shrink-0 items-center gap-2">
        <input aria-label={`${THEME_COLOR_LABELS[colorKey]} color`} type="color" value={theme.colors[colorKey]} onChange={(event) => onChange(colorKey, event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
        <code className="w-16 text-right text-[10px] text-slate-500">{theme.colors[colorKey]}</code>
      </span>
    </label>
  );
}