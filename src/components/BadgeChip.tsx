import React from 'react';
import type { AdminBadge } from '../../shared/types.ts';

interface BadgeChipProps {
  badge: AdminBadge;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export const BadgeChip: React.FC<BadgeChipProps> = ({ badge, size = 'sm', showLabel = true }) => {
  const isSmall = size === 'sm';
  return (
    <span
      title={badge.description || badge.label}
      className={`inline-flex items-center gap-1 rounded-md border font-medium whitespace-nowrap ${
        isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'
      }`}
      style={{
        color: badge.color,
        borderColor: `${badge.color}55`,
        backgroundColor: `${badge.color}1f`,
      }}
    >
      <span aria-hidden="true" className={isSmall ? 'text-[11px] leading-none' : 'text-sm leading-none'}>
        {badge.icon}
      </span>
      {showLabel && <span>{badge.label}</span>}
    </span>
  );
};

interface BadgeRowProps {
  badges?: AdminBadge[];
  max?: number;
  size?: 'sm' | 'md';
}

export const BadgeRow: React.FC<BadgeRowProps> = ({ badges, max = 4, size = 'sm' }) => {
  if (!badges || badges.length === 0) return null;
  const visible = badges.slice(0, max);
  const overflow = badges.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((badge) => (
        <BadgeChip key={badge.id} badge={badge} size={size} />
      ))}
      {overflow > 0 && (
        <span
          title={badges.slice(max).map((b) => b.label).join(', ')}
          className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
};
