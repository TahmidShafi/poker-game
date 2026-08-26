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
export function AvatarStrip({
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

  const available = Object.entries(loaded)
    .filter(([, ok]) => ok)
    .map(([k]) => Number(k));

  if (available.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
        Pick your look
      </div>
      <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {available.map((n, idx) => (
          <button
            key={n}
            type="button"
            aria-label={`Avatar ${n}`}
            onClick={() => onChange(value === n ? null : n)}
            style={{ animationDelay: `${idx * 35}ms` }}
            className={`shrink-0 animate-popChip rounded-full transition-transform active:scale-95 ${
              value === n ? "ring-2 ring-gold shadow-glowGold" : "ring-1 ring-white/15 hover:ring-white/40"
            }`}
          >
            <span className="block h-12 w-12">
              <SeatAvatar username={String(n)} avatar={n} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
