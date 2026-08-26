import React from "react";
import { CardBack } from "./CardBack";
import { BackFan } from "./CardFan";

/**
 * Opponent hands are ALWAYS face-down. Only the authoritative remaining-card
 * count drives how many backs render (8 → 0 across a hand).
 *  - top seat: compact horizontal fan
 *  - left/right seats: tight vertical stacks (rotated feel)
 */
export function OpponentHand({
  count,
  position,
}: {
  count: number;
  position: "top" | "left" | "right";
}) {
  const shown = Math.max(0, Math.min(8, count));
  if (shown === 0) {
    return <div className="h-[30px]" aria-hidden />;
  }

  if (position === "top") {
    return (
      <BackFan overlapPx={9} className="drop-shadow">
        {Array.from({ length: shown }, (_, i) => (
          <CardBack key={i} size="sm" />
        ))}
      </BackFan>
    );
  }

  // Side seats: vertical stack with a slight per-card offset for an angled feel.
  return (
    <BackFan vertical overlapPx={13} className="drop-shadow">
      {Array.from({ length: shown }, (_, i) => (
        <div
          key={i}
          style={{ transform: `rotate(${position === "left" ? 90 : -90}deg)` }}
        >
          <CardBack size="xs" />
        </div>
      ))}
    </BackFan>
  );
}
