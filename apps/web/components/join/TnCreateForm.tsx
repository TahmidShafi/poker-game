"use client";

import React from "react";
import type { TnTrumpMode } from "@poker/shared-types";

const MODES: { id: TnTrumpMode; label: string; hint: string }[] = [
  { id: "REGULAR", label: "Regular", hint: "bidder secretly picks trump" },
  { id: "SEVENTH_CARD", label: "7th Card", hint: "trump = bidder's 7th card" },
  { id: "JOKER", label: "Joker", hint: "no suit · J 9 A 10 power ranks" },
  { id: "MARRIAGE", label: "Marriage", hint: "K+Q bonus shifts the bid ±4" },
];

export interface TnSettings {
  trumpMode: TnTrumpMode;
  roundsToWin: number;
}

/** Room settings shown on the Create tab when game type is Twenty-Nine. */
export function TnCreateForm({
  cfg,
  onChange,
}: {
  cfg: TnSettings;
  onChange: (cfg: TnSettings) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
          Trump mode
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...cfg, trumpMode: m.id })}
              className={`rounded-xl px-2 py-2 text-left ring-1 transition-colors ${
                cfg.trumpMode === m.id
                  ? "bg-gold/15 ring-gold/50"
                  : "bg-black/30 ring-white/10 hover:text-white"
              }`}
            >
              <span className={`block text-xs font-bold ${cfg.trumpMode === m.id ? "text-gold" : "text-white/70"}`}>
                {m.label}
              </span>
              <span className="block text-[9px] leading-tight text-white/35">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <Stepper
        label="Rounds to win match"
        value={cfg.roundsToWin}
        step={1}
        min={1}
        max={15}
        onChange={(v) => onChange({ ...cfg, roundsToWin: v })}
      />
      <p className="text-[10px] text-white/30">
        No turn timers — take your time. Offline players auto-play after a grace period.
      </p>
    </div>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(Math.max(v, min), max);
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
      <span className="text-[11px] font-bold uppercase tracking-widest text-white/45">{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(clamp(value - step))} className="h-7 w-7 rounded-lg bg-black/40 text-sm font-bold text-white/60 hover:text-white">
          −
        </button>
        <span className="w-8 text-center tabnum text-sm font-bold text-white/90">{value}</span>
        <button type="button" onClick={() => onChange(clamp(value + step))} className="h-7 w-7 rounded-lg bg-black/40 text-sm font-bold text-white/60 hover:text-white">
          +
        </button>
      </span>
    </label>
  );
}
