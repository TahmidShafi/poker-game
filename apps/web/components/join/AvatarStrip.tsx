"use client";

import React, { useEffect, useState } from "react";
import { SeatAvatar } from "../common/SeatAvatar";

export const AVATAR_COUNT = 10;

/**
 * Horizontal strip of the ten avatar pictures (public/avatars/avatar-N.png).
 * Slots whose file is missing/broken hide themselves; the chosen slot gets
 * the gold ring + glow. Unselected = no avatar (server letter-disc fallback
 * never happens here since we always render the picture when it loads).
 */
function AvatarStripComponent({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (avatar: number | null) => void;
}) {
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});

  // Probe which pictures actually exist.
  useEffect(() => {
    let cancelled = false;
    for (let i = 1; i <= AVATAR_COUNT; i++) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setLoaded((prev) => ({ ...prev, [i]: true }));
      };
      img.src = `/avatars/avatar-${i}.png`;
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const available = React.useMemo(() => {
    return Object.entries(loaded)
      .filter(([, ok]) => ok)
      .map(([k]) => Number(k));
  }, [loaded]);

  if (available.length === 0) return null;

  return (
    <div className="w-full min-w-0">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#94A3B8]">
        Pick your look
      </div>
      <div className="scrollbar-none w-full min-w-0 flex gap-1.5 sm:gap-2 overflow-x-auto px-0.5 pb-1 touch-pan-x overscroll-x-contain">
        {available.map((n, idx) => (
          <button
            key={n}
            type="button"
            aria-label={`Avatar ${n}`}
            onClick={() => onChange(value === n ? null : n)}
            style={{ animationDelay: `${idx * 35}ms` }}
            className={`shrink-0 animate-popChip rounded-full transition-all active:scale-95 ${
              value === n
                ? "ring-2 ring-[#F4C95D] shadow-[0_0_16px_rgba(212,175,55,0.45)] scale-105"
                : "ring-1 ring-[#94A3B8]/25 hover:ring-[#F4C95D]/50 hover:scale-102"
            }`}
          >
            <span className="block h-10 w-10 sm:h-12 sm:w-12">
              <SeatAvatar username={String(n)} avatar={n} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const AvatarStrip = React.memo(AvatarStripComponent);
