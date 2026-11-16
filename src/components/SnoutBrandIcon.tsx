import React, { useState } from 'react';

interface SnoutBrandIconProps {
  className?: string;
  alt?: string;
}

export const SnoutBrandIcon: React.FC<SnoutBrandIconProps> = ({
  className = 'h-10 w-10 rounded-xl',
  alt = 'Snout Project Icon',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0D0F12] border border-[#5865F2]/40 overflow-hidden ${className}`}
        aria-label={alt}
      >
        <svg viewBox="0 0 64 64" className="h-[82%] w-[82%]" fill="none" aria-hidden="true">
          <rect width="64" height="64" rx="15" fill="#101322" />
          <path d="M32 12c-13 0-21 7-21 17 0 5.5 3 10 8 12.5L17.5 51l10-5c1.5.2 3 .3 4.5.3 13 0 21-7 21-17S45 12 32 12Z" fill="#F8FAFC" />
          <ellipse cx="25.5" cy="29" rx="3.2" ry="5" fill="#0B0D14" />
          <ellipse cx="38.5" cy="29" rx="3.2" ry="5" fill="#0B0D14" />
          <path d="M27 38c3 2.2 7 2.2 10 0" stroke="#0B0D14" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M49 10l1.7 4.3L55 16l-4.3 1.7L49 22l-1.7-4.3L43 16l4.3-1.7L49 10Z" fill="#FBBF24" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src="/snout-icon.svg"
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover select-none ${className}`}
    />
  );
};
