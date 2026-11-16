import React, { useState } from 'react';
import { ANIMATED_BANNER_PRESETS } from '../../shared/constants.ts';

interface AnimatedBannerProps {
  bannerUrl?: string | null;
  fallbackImage?: string;
  alt?: string;
  className?: string;
  showAnimatedLabel?: boolean;
  children?: React.ReactNode;
}

const PRESET_BG_CLASSES: Record<string, { bg: string; orbA: string; orbB: string }> = {
  aurora_drift: {
    bg: 'bg-gradient-to-br from-[#090D16] via-[#14224A] to-[#0E3A3A]',
    orbA: 'bg-[#5865F2]/35',
    orbB: 'bg-emerald-400/30',
  },
  soundwave_horizon: {
    bg: 'bg-gradient-to-br from-[#0D0F18] via-[#24194D] to-[#172554]',
    orbA: 'bg-indigo-400/35',
    orbB: 'bg-purple-400/30',
  },
  obsidian_gold: {
    bg: 'bg-gradient-to-br from-[#0B0C10] via-[#2B1F0E] to-[#16181F]',
    orbA: 'bg-amber-500/35',
    orbB: 'bg-amber-200/20',
  },
  prism_lattice: {
    bg: 'bg-gradient-to-br from-[#11131F] via-[#2E1065] to-[#0F4C5C]',
    orbA: 'bg-sky-400/35',
    orbB: 'bg-pink-400/30',
  },
  signal_pulse: {
    bg: 'bg-gradient-to-br from-[#060C14] via-[#0C2D48] to-[#083344]',
    orbA: 'bg-cyan-400/35',
    orbB: 'bg-blue-400/30',
  },
  solar_corona: {
    bg: 'bg-gradient-to-br from-[#14090E] via-[#4C1023] to-[#3F1D0B]',
    orbA: 'bg-rose-500/35',
    orbB: 'bg-orange-400/30',
  },
};

export function isAnimatedBannerValue(bannerUrl?: string | null): boolean {
  if (!bannerUrl) return false;
  if (bannerUrl.startsWith('preset:')) return true;
  return /\.(gif|webp|apng)(\?.*)?$/i.test(bannerUrl);
}

export const AnimatedBanner: React.FC<AnimatedBannerProps> = ({
  bannerUrl,
  fallbackImage,
  alt = 'Banner',
  className = 'h-28',
  showAnimatedLabel = false,
  children,
}) => {
  const [imgError, setImgError] = useState(false);

  const preset = bannerUrl?.startsWith('preset:')
    ? ANIMATED_BANNER_PRESETS.find((p) => p.token === bannerUrl) || ANIMATED_BANNER_PRESETS[0]
    : null;

  const isGifOrImage = Boolean(bannerUrl && !bannerUrl.startsWith('preset:') && !imgError);
  const presetStyle = preset ? PRESET_BG_CLASSES[preset.id] || PRESET_BG_CLASSES.aurora_drift : null;

  return (
    <div className={`relative overflow-hidden bg-[#171A21] ${className}`}>
      {preset && presetStyle ? (
        <>
          <div className={`absolute inset-0 ${presetStyle.bg}`} />

          {/* Compositor-animated drifting aurora orbs */}
          <div
            aria-hidden="true"
            className={`chord-anim-drift absolute -left-12 -top-12 h-44 w-56 rounded-full blur-2xl ${presetStyle.orbA}`}
          />
          <div
            aria-hidden="true"
            className={`chord-anim-drift-reverse absolute -bottom-10 right-0 h-40 w-52 rounded-full blur-2xl ${presetStyle.orbB}`}
          />

          {/* Continuous harmonic SVG wave strip */}
          <svg
            aria-hidden="true"
            viewBox="0 0 800 120"
            preserveAspectRatio="none"
            className="chord-anim-wave pointer-events-none absolute inset-y-0 left-0 h-full w-[200%] opacity-65"
          >
            <path
              d="M0,72 C75,32 150,104 225,64 C300,24 375,98 400,72 C475,32 550,104 625,64 C700,24 775,98 800,72"
              fill="none"
              stroke={preset.waveStroke}
              strokeWidth="2"
            />
            <path
              d="M0,88 C90,54 160,112 250,76 C330,44 370,96 400,88 C490,54 560,112 650,76 C730,44 770,96 800,88"
              fill="none"
              stroke={preset.accentSecondary}
              strokeOpacity="0.32"
              strokeWidth="1.5"
            />
          </svg>

          {/* Subtle diagonal glass sheen sweep */}
          <div
            aria-hidden="true"
            className="chord-anim-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
          />
        </>
      ) : isGifOrImage ? (
        <img
          src={bannerUrl!}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : fallbackImage ? (
        <img
          src={fallbackImage}
          alt={alt}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover opacity-75"
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-r from-[#171A21] via-[#1E2433] to-[#171A21]" />
      )}

      {/* Contrast bottom scrim */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#12151A]/90 via-transparent to-black/25" />

      {showAnimatedLabel && isAnimatedBannerValue(bannerUrl) && (
        <span className="pointer-events-none absolute left-3 top-2.5 font-mono text-[10px] font-semibold tracking-wider text-white/75 uppercase">
          {preset ? preset.name : 'Animated Banner'}
        </span>
      )}

      {children}
    </div>
  );
};
