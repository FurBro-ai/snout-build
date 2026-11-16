import React, { useEffect, useState } from 'react';
import {
  Apple,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  Monitor,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wifi,
  Zap,
} from 'lucide-react';
import { SnoutBrandIcon } from '../components/SnoutBrandIcon.tsx';

interface DownloadFile {
  file: string;
  size: number;
  sha256?: string;
}

interface DownloadManifest {
  version: string;
  publishedAt: string;
  channel: string;
  files: {
    mac?: DownloadFile;
    win?: DownloadFile;
    linux?: DownloadFile;
    checksums?: DownloadFile;
  };
  notes?: string[];
}

const DOWNLOAD_BASE = '/downloads';
const DEFAULT_MANIFEST: DownloadManifest = {
  version: '1.0.0',
  publishedAt: '',
  channel: 'stable',
  files: {
    mac: { file: 'Snout-macOS-universal.dmg', size: 0 },
    win: { file: 'Snout-Windows-x64-setup.exe', size: 0 },
    linux: { file: 'Snout-Linux-x86_64.AppImage', size: 0 },
    checksums: { file: 'SHA256SUMS.txt', size: 0 },
  },
};

function downloadUrl(file: string): string {
  return `${DOWNLOAD_BASE}/${file}`;
}

type Platform = 'mac' | 'win' | 'linux' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();
  if (ua.includes('mac') || platform.includes('mac')) return 'mac';
  if (ua.includes('win') || platform.includes('win')) return 'win';
  if (ua.includes('linux') || platform.includes('linux')) return 'linux';
  return 'other';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export const DownloadPage: React.FC = () => {
  const [manifest, setManifest] = useState<DownloadManifest>(DEFAULT_MANIFEST);
  const [loadError, setLoadError] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [online, setOnline] = useState<{ members: number; servers: number } | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    let cancelled = false;
    const cached = sessionStorage.getItem('snout_download_manifest');
    if (cached) {
      try {
        setManifest(JSON.parse(cached) as DownloadManifest);
      } catch {
        // ignore malformed cache
      }
    }
    fetch(`${DOWNLOAD_BASE}/latest.json`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no manifest'))))
      .then((data: DownloadManifest) => {
        if (cancelled || !data || !data.files) return;
        setManifest(data);
        sessionStorage.setItem('snout_download_manifest', JSON.stringify(data));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    fetch('/api/platform/summary')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { memberCount?: number; serverCount?: number } | null) => {
        if (!cancelled && data) setOnline({ members: data.memberCount || 0, servers: data.serverCount || 0 });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const macFile = manifest.files.mac;
  const winFile = manifest.files.win;
  const linuxFile = manifest.files.linux;
  const checksumsFile = manifest.files.checksums;
  const version = manifest.version || '1.0.0';

  const cards = [
    {
      key: 'win' as const,
      icon: Monitor,
      label: 'Windows',
      detail: 'Windows 10 / 11 · x64',
      href: winFile ? downloadUrl(winFile.file) : '/downloads/Snout-Windows-x64-setup.exe',
      size: winFile?.size ? formatBytes(winFile.size) : '.exe installer',
      sha256: winFile?.sha256,
    },
    {
      key: 'mac' as const,
      icon: Apple,
      label: 'macOS',
      detail: 'macOS 11+ · Apple Silicon & Intel',
      href: macFile ? downloadUrl(macFile.file) : '/downloads/Snout-macOS-universal.dmg',
      size: macFile?.size ? formatBytes(macFile.size) : '.dmg universal',
      sha256: macFile?.sha256,
    },
    {
      key: 'linux' as const,
      icon: Terminal,
      label: 'Linux',
      detail: 'AppImage · x86_64',
      href: linuxFile ? downloadUrl(linuxFile.file) : '/downloads/Snout-Linux-x86_64.AppImage',
      size: linuxFile?.size ? formatBytes(linuxFile.size) : '.AppImage',
      sha256: linuxFile?.sha256,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2.5">
          <SnoutBrandIcon className="h-9 w-9 rounded-xl ring-1 ring-white/15" />
          <span className="font-display text-lg font-bold">Snout</span>
        </a>
        <nav className="flex items-center gap-3 text-xs">
          <a href="/" className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Open web app
          </a>
          <a href={downloadUrl(checksumsFile?.file || 'SHA256SUMS.txt')} className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white">
            Checksums <ExternalLink className="h-3 w-3" />
          </a>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20">
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#151A26] via-[#0E1118] to-[#101720] px-6 py-10 sm:px-10 sm:py-14">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#5865F2]/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              <Sparkles className="h-3 w-3" /> Native desktop · v{version}
            </span>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight sm:text-5xl">
              Snout for desktop.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
              Faster calls, global voice relays, and one-click access to every community. Auto server
              selection picks the lowest-latency relay for your network — on every continent.
            </p>
          </div>
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            const isCurrent = platform === card.key;
            return (
              <a
                key={card.key}
                href={card.href}
                className={`group rounded-2xl border p-5 transition-all ${
                  isCurrent
                    ? 'border-[#5865F2]/60 bg-[#5865F2]/10 shadow-lg shadow-indigo-950/30'
                    : 'border-white/[0.08] bg-[#12151A] hover:border-white/20 hover:bg-[#171B23]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#0D0F12] text-slate-200">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-display text-sm font-semibold text-white">{card.label}</div>
                      <div className="text-[11px] text-slate-400">{card.detail}</div>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-[#5865F2] px-2 py-0.5 text-[10px] font-semibold text-white">your OS</span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-slate-500">{card.size}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white group-hover:bg-[#4752C4]">
                    <Download className="h-3.5 w-3.5" /> Download
                  </span>
                </div>
              </a>
            );
          })}
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Globe2, title: 'Auto relay selection', body: 'Every client measures real TURN latency and joins the fastest node automatically.' },
            { icon: Zap, title: 'Low-latency voice', body: 'Short-lived TURN credentials, UDP-first media, and regional relays on two continents today.' },
            { icon: Wifi, title: 'Screen share & camera', body: 'Share a window, a screen, or your camera — with push-to-talk and noise suppression.' },
            { icon: ShieldCheck, title: 'Signed sessions', body: 'JWT sessions, optional TOTP 2FA, and a native shell with sandboxed navigation.' },
          ].map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-2xl border border-white/[0.07] bg-[#12151A] p-4">
                <Icon className="h-4 w-4 text-[#818CF8]" />
                <div className="mt-2 font-display text-sm font-semibold text-white">{feature.title}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{feature.body}</p>
              </div>
            );
          })}
        </section>

        <section className="mt-8 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#12151A] p-5">
            <h2 className="font-display text-sm font-semibold text-white">Install notes</h2>
            <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-400">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Windows: run the installer, then choose <span className="text-slate-200">More info → Run anyway</span> if SmartScreen warns (builds are not code-signed yet).</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> macOS: open the .dmg, drag Snout to Applications, then right-click → Open the first time (Gatekeeper blocks unsigned apps by default).</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Linux: <span className="font-mono text-slate-300">chmod +x Snout-Linux-x86_64.AppImage && ./Snout-Linux-x86_64.AppImage</span></li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Downloads are served directly from the Snout server. Verify with the published SHA-256 checksums.</li>
            </ul>
            {loadError && (
              <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Live build manifest is unavailable; links point at the stable filenames hosted in /downloads.
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-[#12151A] p-5">
            <h2 className="font-display text-sm font-semibold text-white">Platform status</h2>
            <div className="mt-3 space-y-2 text-[11px] text-slate-400">
              <div className="flex items-center justify-between"><span>Web API</span><span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Operational</span></div>
              <div className="flex items-center justify-between"><span>Community</span><span className="text-slate-200">{online ? `${online.members} members · ${online.servers} servers` : '—'}</span></div>
              <div className="flex items-center justify-between"><span>Voice relays</span><span className="text-slate-200">Sydney · Stockholm</span></div>
              <div className="flex items-center justify-between"><span>Desktop version</span><span className="font-mono text-slate-200">v{version}</span></div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-white/[0.06] py-6 text-center text-[11px] text-slate-500">
        Built for every platform · served from snout.cloud · <a href="/" className="text-slate-400 hover:text-white">Open the web app</a>
      </footer>
    </div>
  );
};

