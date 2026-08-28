"use client";

import React, { useEffect, useState } from "react";

/**
 * Interval-driven countdown ring (~200ms tick; a per-frame rAF loop
 * re-rendered seats/bars 60x/s and drained mobile battery).
 * Renders nothing when inactive.
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

export type TimerUrgency = "normal" | "warning" | "urgent";

export function getTimerUrgency(remainingMs: number): TimerUrgency {
  if (remainingMs > 0 && remainingMs < 5000) return "urgent";
  if (remainingMs >= 5000 && remainingMs < 10000) return "warning";
  return "normal";
}

export function getTimerIcon(urgency: TimerUrgency): string {
  switch (urgency) {
    case "urgent":
      return "!";
    case "warning":
      return "⚠";
    case "normal":
      return "⏱";
  }
}

/**
 * Accessible turn timer countdown ring with multi-sensory and colorblind-friendly cues:
 * - Normal (>10s): Smooth gold conic sweep, 3px standard stroke.
 * - Warning (5-10s): Amber conic sweep with thicker (3.5px) dashed ring pattern for non-color discrimination.
 * - Urgent (<5s): Heavy 4px crimson sweep with rapid pulsating keyframe glow.
 */
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
  const urgency = getTimerUrgency(remainingMs);
  const color =
    urgency === "urgent" ? "#C0392B" : urgency === "warning" ? "#e0a83c" : "#D8B36A";

  return (
    <div
      className={`relative rounded-full transition-all duration-200 ${
        urgency === "urgent"
          ? "animate-pulseRed ring-2 ring-crimson/80"
          : urgency === "warning"
          ? "ring-2 ring-dashed ring-amber-400/90 shadow-[0_0_8px_rgba(224,168,60,0.4)]"
          : "ring-1 ring-white/10"
      }`}
      style={{
        background: active
          ? `conic-gradient(${color} ${pct * 360}deg, rgba(255,255,255,0.08) 0deg)`
          : "transparent",
        padding: urgency === "urgent" ? 4 : urgency === "warning" ? 3.5 : 3,
      }}
    >
      <div className="rounded-full" style={{ background: active ? "#0b0f14" : "transparent" }}>
        {children}
      </div>
    </div>
  );
}
