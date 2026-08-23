"use client";

import React, { useEffect, useState } from "react";

/**
 * Interval-driven countdown ring (~200ms tick; a per-frame rAF loop
 * re-rendered seats/bars 60x/s and drained mobile battery).
 * Renders nothing when inactive. Turns amber under 10s, pulsing red under 5s.
 */
export function useCountdown(deadline: number | null, active: boolean): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline || !active) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(Math.max(0, deadline - Date.now()));
    update();
    const iv = setInterval(update, 200);
    return () => clearInterval(iv);
  }, [deadline, active]);
  return remaining;
}

export function TimerRing({
  remainingMs,
  totalMs,
  children,
}: {
  remainingMs: number;
  totalMs: number;
  children: React.ReactNode;
}) {
  const active = remainingMs > 0 && totalMs > 0;
  const pct = active ? Math.min(1, remainingMs / totalMs) : 0;
  const urgent = remainingMs > 0 && remainingMs < 5000;
  const color = urgent ? "#C0392B" : remainingMs > 0 && remainingMs < 10000 ? "#e0a83c" : "#D8B36A";

  return (
    <div
      className={`relative rounded-full ${urgent ? "animate-pulseRed" : ""}`}
      style={{
        background: active
          ? `conic-gradient(${color} ${pct * 360}deg, rgba(255,255,255,0.08) 0deg)`
          : "transparent",
        padding: active ? 3 : 0,
      }}
    >
      <div className="rounded-full" style={{ background: active ? "#0b0f14" : "transparent" }}>
        {children}
      </div>
    </div>
  );
}
