"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useGame } from "../lib/store";
import type { RoomConfig } from "@poker/shared-types";
import { AvatarStrip } from "./join/AvatarStrip";
import { CodeBoxes } from "./join/CodeBoxes";
import { CreateForm } from "./join/CreateForm";
import { TnCreateForm, type TnSettings } from "./join/TnCreateForm";
import { PlayingCard } from "./PlayingCard";

const DEFAULTS: RoomConfig = {
  startingCoins: 1000,
  smallBlind: 10,
  bigBlind: 20,
  turnTimeSeconds: 60,
};

const TN_DEFAULTS: TnSettings = { trumpMode: "REGULAR", roundsToWin: 6 };

const USERNAME_KEY = "poker.username";
const AVATAR_KEY = "poker.avatar";

/** Entry screen — split hero with drifting cards (desktop) + the action card. */
export function JoinScreen() {
  const { joinRoom, createRoom, pushToast, status } = useGame();
  const [tab, setTab] = useState<"join" | "create">("join");
  const [game, setGame] = useState<"POKER" | "TWENTY_NINE">("POKER");
  const [tnCfg, setTnCfg] = useState<TnSettings>(TN_DEFAULTS);
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<RoomConfig>(DEFAULTS);

  // Remembered identity + ?room=CODE deep link.
  useEffect(() => {
    setUsername(localStorage.getItem(USERNAME_KEY) ?? "");
    const savedAvatar = Number(localStorage.getItem(AVATAR_KEY));
    if (savedAvatar >= 1 && savedAvatar <= 10) setAvatar(savedAvatar);

    const p = new URLSearchParams(window.location.search).get("room");
    if (p) {
      setCode(p.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
      setTab("join");
    }
  }, []);

  const submit = useCallback(async () => {
    const name = username.trim();
    if (name.length < 1 || name.length > 16) {
      pushToast("username must be 1-16 characters");
      return;
    }
    if (tab === "join") {
      if (code.length !== 6) {
        setCodeInvalid(true);
        setTimeout(() => setCodeInvalid(false), 450);
        return;
      }
      setBusy(true);
      const ack = await joinRoom(code, name, avatar ?? undefined);
      setBusy(false);
      if (ack.ok) rememberIdentity(name, avatar);
    } else if (game === "TWENTY_NINE") {
      setBusy(true);
      const cfg: RoomConfig = {
        startingCoins: DEFAULTS.startingCoins,
        smallBlind: DEFAULTS.smallBlind,
        bigBlind: DEFAULTS.bigBlind,
        turnTimeSeconds: DEFAULTS.turnTimeSeconds,
        gameType: "TWENTY_NINE",
        twentyNine: tnCfg,
      };
      const ack = await createRoom(name, cfg, avatar ?? undefined);
      setBusy(false);
      if (ack.ok) rememberIdentity(name, avatar);
    } else {
      setBusy(true);
      const ack = await createRoom(name, { ...cfg, gameType: "POKER" }, avatar ?? undefined);
      setBusy(false);
      if (ack.ok) rememberIdentity(name, avatar);
    }
  }, [username, avatar, code, tab, game, tnCfg, cfg, joinRoom, createRoom, pushToast]);

  const nameOk = username.trim().length >= 1 && username.trim().length <= 16;
  const canSubmit = nameOk && (tab === "create" || code.length === 6) && !busy;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* ================= floating cards layer ================= */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden dt:block">
        <div className="absolute left-[8%] top-[14%] animate-floatY" style={{ "--fl-rot": "-10deg", animationDelay: "0s" } as React.CSSProperties}>
          <PlayingCard card={{ rank: 14, suit: "SPADES" }} size="lg" className="shadow-panel" />
        </div>
        <div className="absolute left-[20%] top-[38%] animate-floatY" style={{ "--fl-rot": "7deg", animationDelay: "-2s" } as React.CSSProperties}>
          <PlayingCard card={{ rank: 13, suit: "HEARTS" }} size="lg" className="shadow-panel" />
        </div>
        <div className="absolute left-[9%] top-[60%] animate-floatY" style={{ "--fl-rot": "-4deg", animationDelay: "-3.6s" } as React.CSSProperties}>
          <PlayingCard card={{ rank: 12, suit: "DIAMONDS" }} size="lg" className="shadow-panel" />
        </div>
        <div className="absolute left-[26%] top-[76%] hidden xl:block animate-floatY" style={{ "--fl-rot": "11deg", animationDelay: "-1.2s" } as React.CSSProperties}>
          <PlayingCard faceDown size="lg" className="shadow-panel" />
        </div>

        {/* mini felt preview under the brand */}
        <div className="absolute bottom-[7%] left-[13%]">
          <div className="rail-surface rounded-full p-3">
            <div className="felt-surface gold-ring grid h-40 w-[24rem] place-items-center rounded-full">
              <div className="flex gap-1.5">
                <PlayingCard card={{ rank: 10, suit: "SPADES" }} size="sm" delay={200} animate="deal" />
                <PlayingCard card={{ rank: 11, suit: "SPADES" }} size="sm" delay={350} animate="deal" />
                <PlayingCard card={{ rank: 12, suit: "SPADES" }} size="sm" delay={500} animate="deal" />
                <PlayingCard faceDown size="sm" delay={650} animate="deal" />
                <PlayingCard faceDown size="sm" delay={800} animate="deal" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* mobile ambient card */}
      <div aria-hidden className="pointer-events-none absolute -right-6 top-10 rotate-12 opacity-25 dt:hidden">
        <PlayingCard card={{ rank: 14, suit: "SPADES" }} size="md" />
      </div>

      {/* ================= layout grid ================= */}
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-8 dt:grid-cols-[1.05fr_420px]">
        {/* Hero (desktop only) */}
        <section className="hidden dt:block">
          <Brand />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/50">
            Deal your friends in. One room code is all it takes — full No-Limit
            Hold&apos;em with turn timers, side pots and player loans.
          </p>
          <ul className="mt-5 space-y-1.5 text-xs text-white/45">
            <li>♠ server-authoritative dealing &amp; showdown</li>
            <li>♦ hidden cards never leave the server pre-showdown</li>
            <li>♣ virtual chips only — zero stakes, all bragging rights</li>
          </ul>
        </section>

        {/* Action card */}
        <section className="glass mx-auto w-full max-w-md rounded-3xl p-6 shadow-panel animate-riseFade">
          <div className="dt:hidden">
            <Brand compact />
          </div>

          <div className="mt-4 space-y-3.5">
            <AvatarStrip value={avatar} onChange={setAvatar} />

            <label className="block">
              <span className="mb-1 flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Username</span>
                <span className={`text-[10px] tabnum ${nameOk ? "text-white/30" : "text-crimson"}`}>
                  {username.trim().length}/16
                </span>
              </span>
              <input
                className="w-full rounded-xl bg-black/35 px-3.5 py-2.5 text-sm ring-1 ring-white/12 focus:outline-none focus:ring-gold/50 placeholder:text-white/30"
                placeholder="What should the table call you?"
                maxLength={16}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
              />
            </label>

            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black/30 p-1 text-sm font-semibold">
              <button
                className={`rounded-xl py-2 transition-colors ${tab === "join" ? "bg-gold/20 text-gold" : "text-white/55 hover:text-white"}`}
                onClick={() => setTab("join")}
              >
                Join room
              </button>
              <button
                className={`rounded-xl py-2 transition-colors ${tab === "create" ? "bg-gold/20 text-gold" : "text-white/55 hover:text-white"}`}
                onClick={() => setTab("create")}
              >
                Create room
              </button>
            </div>

            {tab === "create" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGame("POKER")}
                  className={`rounded-2xl px-3 py-2.5 text-left ring-1 transition-all ${
                    game === "POKER"
                      ? "bg-gold/15 ring-gold/60"
                      : "bg-black/30 ring-white/10 hover:ring-white/25"
                  }`}
                >
                  <span className={`block text-sm font-black ${game === "POKER" ? "text-gold" : "text-white/70"}`}>
                    ♠ Texas Hold&apos;em
                  </span>
                  <span className="block text-[9.5px] text-white/40">blinds, side pots & loans</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGame("TWENTY_NINE")}
                  className={`rounded-2xl px-3 py-2.5 text-left ring-1 transition-all ${
                    game === "TWENTY_NINE"
                      ? "bg-gold/15 ring-gold/60"
                      : "bg-black/30 ring-white/10 hover:ring-white/25"
                  }`}
                >
                  <span className={`block text-sm font-black ${game === "TWENTY_NINE" ? "text-gold" : "text-white/70"}`}>
                    ♦ Twenty-Nine
                  </span>
                  <span className="block text-[9.5px] text-white/40">4 players · teams · hidden trump</span>
                </button>
              </div>
            )}

            {tab === "join" ? (
              <div className="space-y-2">
                <span className="block text-center text-[10px] font-bold uppercase tracking-[0.25em] text-white/40">
                  Room code
                </span>
                <CodeBoxes
                  value={code}
                  onChange={(v) => setCode(v)}
                  invalid={codeInvalid}
                />
              </div>
            ) : game === "TWENTY_NINE" ? (
              <TnCreateForm cfg={tnCfg} onChange={setTnCfg} />
            ) : (
              <CreateForm cfg={cfg} onChange={(next) => setCfg({ ...next, gameType: "POKER" })} />
            )}

            <button
              disabled={!canSubmit}
              onClick={submit}
              className="w-full rounded-xl bg-gold py-3 text-sm font-black tracking-wide text-ink shadow-glowGold transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {busy
                ? "Connecting…"
                : tab === "join"
                  ? code.length === 6
                    ? `Take my seat → ${code}`
                    : "Take a seat"
                  : game === "TWENTY_NINE"
                    ? "Open the 29 table"
                    : "Open the table"}
            </button>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] text-white/30">
                Virtual chips only — no real-money gambling.
              </p>
              <span className="flex items-center gap-1.5 text-[10px] text-white/30" title={status}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status === "online" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-crimson"
                  }`}
                />
                {status}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function rememberIdentity(name: string, avatar: number | null): void {
  try {
    localStorage.setItem(USERNAME_KEY, name);
    if (avatar !== null) localStorage.setItem(AVATAR_KEY, String(avatar));
  } catch {
    /* storage unavailable */
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-gold to-goldDim text-ink shadow-glowGold">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
          <path d="M12 2C9 7 4 9.5 4 13.6 4 17.2 7 20 12 22c5-2 8-4.8 8-8.4C20 9.5 15 7 12 2z" />
        </svg>
      </span>
      <div className="leading-none">
        <h1 className="text-3xl font-black tracking-tight">
          Hold<span className="text-gold">&apos;em</span> Club
        </h1>
        {!compact && (
          <p className="mt-1.5 text-[11px] uppercase tracking-[0.3em] text-white/40">
            private poker tables · virtual chips
          </p>
        )}
      </div>
    </div>
  );
}
