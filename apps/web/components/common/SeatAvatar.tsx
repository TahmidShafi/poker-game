"use client";

import React, { useEffect, useState } from "react";
import { SEAT_HUES } from "./seatHues";

/**
 * A player's avatar disc: their chosen picture (1-10) rendered as a circle,
 * or a colored letter-disc fallback when no picture is set or it fails to
 * load. Fills its parent — the parent owns sizing and the ring/glow classes.
 */
export function SeatAvatar({
  username,
  avatar,
  dimmed = false,
}: {
  username: string | null | undefined;
  avatar?: number;
  /** fade content when the seat is offline */
  dimmed?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  // Reset the fallback when a different picture arrives.
  useEffect(() => setBroken(false), [avatar]);

  const initial = (username ?? "?").charAt(0).toUpperCase();
  const hue = SEAT_HUES[hashName(username) % SEAT_HUES.length];
  const fallbackBg = `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${hue} 55% 22%))`;
  const showImage = avatar !== undefined && !broken;

  return (
    <span className={`relative block h-full w-full overflow-hidden rounded-full ${dimmed ? "opacity-40" : ""}`}>
      {showImage ? (
        <img
          src={`/avatars/avatar-${avatar}.png`}
          alt={username ?? "player"}
          draggable={false}
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      ) : (
        <span
          className="absolute inset-0 grid place-items-center font-bold text-lg"
          style={{ background: fallbackBg }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}

/** Stable per-name hue so letter discs stay consistent across renders. */
function hashName(name: string | null | undefined): number {
  if (!name) return 0;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 10;
}
