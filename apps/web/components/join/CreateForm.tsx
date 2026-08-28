"use client";

import React from "react";
import type { RoomConfig } from "@poker/shared-types";

const PRESETS = [
  { id: "quick", label: "🎲 Quick", cfg: { startingCoins: 200, smallBlind: 5, bigBlind: 10, turnTimeSeconds: 15 } },
  { id: "casual", label: "🛋️ Casual", cfg: { startingCoins: 1000, smallBlind: 10, bigBlind: 20, turnTimeSeconds: 60 } },
  { id: "long", label: "💼 Long", cfg: { startingCoins: 5000, smallBlind: 25, bigBlind: 50, turnTimeSeconds: 90 } },
] as const;

/**
 * Room-config editor for creators: one-tap presets, −/+ steppers and a live
 * "starting coins ≥ 10× big blind" validation hint (mirrors server rule).
 */
export function CreateForm({
  cfg,
  onChange,
}: {
  cfg: RoomConfig;
  onChange: (cfg: RoomConfig) => void;
}) {
  const coinsOk = cfg.startingCoins >= cfg.bigBlind * 10;
  const set = (patch: Partial<RoomConfig>) => onChange({ ...cfg, ...patch });

  return (
    <div className="space-y-3 w-full min-w-0">
      <div className="grid grid-cols-3 gap-1 sm:gap-1.5 w-full min-w-0">
        {PRESETS.map((p) => {
          const active =
            cfg.startingCoins === p.cfg.startingCoins &&
            cfg.smallBlind === p.cfg.smallBlind &&
            cfg.bigBlind === p.cfg.bigBlind &&
            cfg.turnTimeSeconds === p.cfg.turnTimeSeconds;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ ...p.cfg })}
              className={`rounded-xl py-2 px-1 text-xs font-bold truncate transition-colors min-w-0 ${
                active
                  ? "bg-gold/20 text-gold ring-1 ring-gold/50"
                  : "bg-black/30 text-white/60 ring-1 ring-white/10 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <Stepper
        label="Starting coins"
        value={cfg.startingCoins}
        step={50}
        min={50}
        max={1_000_000}
        onChange={(v) => set({ startingCoins: v })}
      />
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 w-full min-w-0">
        <Stepper
          label="Small blind"
          value={cfg.smallBlind}
          min={1}
          max={5000}
          onChange={(v) => set({ smallBlind: v })}
        />
        <Stepper
          label="Big blind"
          value={cfg.bigBlind}
          min={2}
          max={10_000}
          onChange={(v) => set({ bigBlind: v })}
        />
      </div>
      <Stepper
        label="Turn seconds"
        value={cfg.turnTimeSeconds}
        step={5}
        min={5}
        max={120}
        onChange={(v) => set({ turnTimeSeconds: v })}
      />

      <p
        className={`text-center text-[11px] font-semibold ${
          coinsOk ? "text-emerald-300/80" : "text-crimson"
        }`}
      >
        {coinsOk
          ? `✓ table buys in at ${Math.floor(cfg.startingCoins / cfg.bigBlind)}× the big blind`
          : `starting coins must be at least ${cfg.bigBlind * 10} (10× the big blind)`}
      </p>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 1,
  max = 1_000_000,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <label className="block w-full min-w-0">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/45 truncate">{label}</span>
      <span className="flex items-stretch overflow-hidden rounded-xl bg-black/35 ring-1 ring-white/12 focus-within:ring-gold/50 w-full min-w-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange(clamp(value - step))}
          className="w-8 sm:w-9 shrink-0 text-white/50 transition-colors hover:bg-white/5 hover:text-gold"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          onBlur={() => onChange(clamp(Math.round(value) || min))}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full min-w-0 bg-transparent px-1 py-2 text-center text-sm tabnum focus:outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange(clamp(value + step))}
          className="w-8 sm:w-9 shrink-0 text-white/50 transition-colors hover:bg-white/5 hover:text-gold"
        >
          +
        </button>
      </span>
    </label>
  );
}
