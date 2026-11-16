import React from 'react';
import { NITRO_DECORATIONS } from '../../shared/constants.ts';
import type { PresenceStatus, PublicUser } from '../../shared/types.ts';

interface UserAvatarProps {
  user?: Partial<PublicUser> | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
  speaking?: boolean;
  onClick?: () => void;
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

const STATUS_DOT_CLASSES = {
  xs: 'h-2 w-2 border',
  sm: 'h-2.5 w-2.5 border-2',
  md: 'h-3 w-3 border-2',
  lg: 'h-3.5 w-3.5 border-2',
  xl: 'h-4 w-4 border-2',
};

const STATUS_COLORS: Record<PresenceStatus, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-rose-500',
  offline: 'bg-slate-500',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  size = 'md',
  showStatus = false,
  speaking = false,
  onClick,
}) => {
  const [imgError, setImgError] = React.useState(false);
  const src = (user?.isNitro && user?.animatedAvatarUrl) || user?.avatarUrl || null;
  const decoration = NITRO_DECORATIONS.find((d) => d.id === user?.profileDecoration);
  const isAnimatedRing =
    !speaking &&
    user?.isNitro &&
    (user?.profileDecoration === 'chromatic_spin' || user?.profileDecoration === 'obsidian_halo');

  const ringClass = speaking
    ? 'ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]'
    : user?.isNitro && decoration?.ringClass && !isAnimatedRing
    ? decoration.ringClass
    : '';

  const initials = (user?.displayName || user?.username || 'C')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const inner = (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full transition-transform ${
        onClick ? 'cursor-pointer hover:scale-[1.04]' : ''
      } ${SIZE_CLASSES[size]} ${ringClass}`}
    >
      {isAnimatedRing && (
        <span
          aria-hidden="true"
          className={`chord-anim-spin pointer-events-none absolute -inset-[2.5px] rounded-full ${
            user?.profileDecoration === 'chromatic_spin'
              ? 'bg-gradient-to-tr from-[#5865F2] via-emerald-400 to-fuchsia-500'
              : 'bg-gradient-to-tr from-amber-500 via-yellow-200 to-amber-700'
          }`}
        />
      )}
      {src && !imgError ? (
        <img
          src={src}
          alt={user?.displayName || user?.username || 'User avatar'}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="relative z-10 h-full w-full rounded-full object-cover bg-[#1E222B]"
        />
      ) : (
        <div className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#2B3140] to-[#1A1E26] font-semibold text-slate-200 border border-white/10">
          {initials}
        </div>
      )}
      {showStatus && user?.status && (
        <span
          title={user.status === 'dnd' ? 'Do Not Disturb' : user.status}
          className={`absolute -bottom-0.5 -right-0.5 z-20 block rounded-full border-[#12151A] ${STATUS_DOT_CLASSES[size]} ${STATUS_COLORS[user.status]}`}
        />
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]"
      >
        {inner}
      </button>
    );
  }

  return inner;
};
