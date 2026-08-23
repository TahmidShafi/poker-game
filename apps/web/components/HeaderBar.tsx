"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "@poker/shared-types";
import { useGame } from "../lib/store";

function Logo() {
  return (
    <div className="flex items-center gap-1.5 dt:gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-gold to-goldDim text-ink shadow-glowGold dt:h-9 dt:w-9 dt:rounded-xl">
        <svg viewBox="0 0 24 24" className="h-4 w-4 dt:h-5 dt:w-5" fill="currentColor" aria-hidden>
          <path d="M12 2C9 7 4 9.5 4 13.6 4 17.2 7 20 12 22c5-2 8-4.8 8-8.4C20 9.5 15 7 12 2z" />
        </svg>
      </span>
      <div className="leading-none">
        <div className="text-sm font-black tracking-tight dt:text-lg">POKER</div>
        <div className="hidden text-[8px] font-bold uppercase tracking-[0.3em] text-white/45 dt:block">
          Texas Hold&apos;em
        </div>
      </div>
    </div>
  );
}

export function HeaderBar({
  state,
  onOpenRankings,
  onToggleLeft,
  onToggleRight,
  onOpenSheet,
}: {
  state: PublicGameState | null;
  onOpenRankings: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenSheet: () => void;
}) {
  const { me, status, leaveRoom, soundOn, toggleSound } = useGame();
  const [copied, setCopied] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const gearRefM = useRef<HTMLDivElement>(null);
  const gearRefD = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!gearOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!gearRefM.current?.contains(t) && !gearRefD.current?.contains(t)) setGearOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [gearOpen]);

  if (!me) return null;
  const statusColor =
    status === "online" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-crimson";
  const occupied = state?.seats.filter((s) => s.username).length ?? 0;

  const nextHandIn = (() => {
    const dl = state?.nextHandDeadline;
    if (!dl || dl <= now) return null;
    const s = Math.ceil((dl - now) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  })();

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const mySeat = state?.seats[me.seatIndex];

  const iconBtn =
    "grid h-10 w-10 place-items-center rounded-xl bg-panel ring-1 line text-white/70 hover:text-gold hover:ring-gold/40 transition-colors";
  const iconBtnSm =
    "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel ring-1 line text-white/75 active:bg-white/10";

  const gearMenu = (
    <div className="absolute right-0 top-11 z-50 w-52 rounded-2xl bg-panel p-2 text-sm shadow-panel ring-1 line animate-riseFade">
      <label className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 hover:bg-white/5">
        <span>Sound effects</span>
        <input
          type="checkbox"
          checked={soundOn}
          onChange={toggleSound}
          className="h-4 w-4 accent-violet-500"
        />
      </label>
      <button
        className="w-full rounded-xl px-3 py-2 text-left hover:bg-white/5"
        onClick={() => {
          setGearOpen(false);
          onOpenRankings();
        }}
      >
        Hand rankings
      </button>
      <button
        className="w-full rounded-xl px-3 py-2 text-left text-crimson hover:bg-crimson/15"
        onClick={() => {
          setGearOpen(false);
          leaveRoom();
        }}
      >
        Leave table
      </button>
    </div>
  );

  return (
    <header className="relative z-30 rounded-xl bg-panel/90 px-2 py-1.5 ring-1 line backdrop-blur dt:rounded-2xl dt:px-3 dt:py-2.5">
      {/* ================= MOBILE ROW (<md): ☰ ♠ ROOM ⚙ ================= */}
      <div className="flex items-center gap-2 dt:hidden">
        <button className={iconBtnSm} onClick={onOpenSheet} title="Players · stats · history" aria-label="Open game info sheet">
          ☰
        </button>

        <Logo />

        {/* Room code + connection state */}
        <button
          onClick={copyCode}
          className="ml-auto flex min-w-0 items-center gap-1.5 rounded-lg bg-panel2 px-2 py-1.5 ring-1 ring-gold/30 active:ring-gold/60"
          title="Copy room code"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
          <span className="font-mono text-xs font-black tracking-[0.18em] text-gold">
            {me.roomCode}
          </span>
          <span className="text-[10px] text-white/35">{copied ? "✓" : "⧉"}</span>
        </button>

        {/* Gear menu */}
        <div className="relative shrink-0" ref={gearRefM}>
          <button className={iconBtnSm} onClick={() => setGearOpen((o) => !o)} title="Settings" aria-label="Settings menu">
            ⚙
          </button>
          {gearOpen && gearMenu}
        </div>
      </div>

      {/* ================= DESKTOP ROW (md+): unchanged rich header ================= */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-2 dt:flex">
        {/* Drawer toggles (md..xl only; xl has sidebars) */}
        <button className={`${iconBtn} hidden dt:grid xl:hidden`} onClick={onToggleLeft} title="Game info">
          ☰
        </button>

        <Logo />

        {/* Room code */}
        <button
          onClick={copyCode}
          className="flex items-center gap-2 rounded-xl bg-panel2 px-3 py-1.5 ring-1 ring-gold/30 hover:ring-gold/60"
          title="Copy room code"
        >
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-[9px] font-bold uppercase tracking-widest text-white/45">Room Code</span>
          <span className="font-mono text-sm font-black tracking-[0.2em] text-gold">{me.roomCode}</span>
          <span className="text-xs text-white/35">{copied ? "✓" : "⧉"}</span>
        </button>

        {/* Stats cluster */}
        <div className="hidden sm:flex items-center divide-x divide-white/10">
          <Stat label="Players" value={`${occupied} / 10`} />
          {state && <Stat label="Blinds" value={`${state.smallBlind} / ${state.bigBlind}`} gold />}
          {nextHandIn && <Stat label="Next Hand In" value={nextHandIn} gold />}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            className={`${iconBtn} max-xl:hidden`}
            onClick={onOpenRankings}
            title="Hand rankings"
          >
            🏆
          </button>
          <button
            className={`${iconBtn} ${soundOn ? "" : "opacity-40"}`}
            onClick={toggleSound}
            title={soundOn ? "Sound on" : "Sound muted"}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>

          {/* Gear menu */}
          <div className="relative" ref={gearRefD}>
            <button className={iconBtn} onClick={() => setGearOpen((o) => !o)} title="Settings">
              ⚙
            </button>
            {gearOpen && gearMenu}
          </div>

          {/* Self chip */}
          <div className="flex items-center gap-2 rounded-xl bg-panel2 py-1 pl-1 pr-3 ring-1 line">
            <span className="relative grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-emerald-700 to-emerald-900 text-sm font-bold ring-1 ring-white/15">
              {(mySeat?.username ?? me.roomCode).charAt(0).toUpperCase()}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-panel2" />
            </span>
            <div className="leading-none">
              <div className="max-w-[90px] truncate text-xs font-bold">{mySeat?.username ?? "You"}</div>
              <div className="mt-0.5 text-[11px] font-bold text-gold tabnum">
                💰 {mySeat?.coins.toLocaleString() ?? 0}
              </div>
            </div>
          </div>

          <button className={`${iconBtn} hidden dt:grid xl:hidden`} onClick={onToggleRight} title="History & players">
            📊
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <div className="text-[9px] font-bold uppercase tracking-widest text-white/40">{label}</div>
      <div className={`text-sm font-black tabnum ${gold ? "text-gold" : "text-white/85"}`}>{value}</div>
    </div>
  );
}
