"use client";

import React, { useEffect, useState } from "react";
import { useGame } from "../lib/store";
import type { RoomConfig } from "@poker/shared-types";

const DEFAULTS: RoomConfig = {
  startingCoins: 1000,
  smallBlind: 10,
  bigBlind: 20,
  turnTimeSeconds: 60,
};

/** Entry screen: create a private table or join one by code. */
export function JoinScreen() {
  const { joinRoom, createRoom, pushToast } = useGame();
  const [tab, setTab] = useState<"join" | "create">("join");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<RoomConfig>(DEFAULTS);

  // ?room=CODE deep link
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("room");
    if (p) {
      setCode(p.toUpperCase());
      setTab("join");
    }
  }, []);

  const submit = async () => {
    const name = username.trim();
    if (name.length < 1 || name.length > 16) {
      pushToast("username must be 1-16 characters");
      return;
    }
    setBusy(true);
    if (tab === "join") {
      if (code.trim().length !== 6) {
        setBusy(false);
        return pushToast("enter the 6-character room code");
      }
      await joinRoom(code.trim().toUpperCase(), name);
    } else {
      await createRoom(name, cfg);
    }
    setBusy(false);
  };

  const input =
    "w-full rounded-xl bg-black/35 px-3.5 py-2.5 text-sm ring-1 ring-white/12 focus:outline-none focus:ring-gold/50 placeholder:text-white/30";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-3xl p-6 animate-riseFade">
        <h1 className="text-center text-3xl font-black tracking-tight">
          Hold<span className="text-gold">'em</span> Club
        </h1>
        <p className="mt-1 text-center text-xs uppercase tracking-[0.25em] text-white/40">
          private poker tables · virtual chips
        </p>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-black/30 p-1 text-sm font-semibold">
          <button
            className={`rounded-xl py-2 transition-colors ${tab === "join" ? "bg-gold/20 text-gold" : "text-white/55"}`}
            onClick={() => setTab("join")}
          >
            Join room
          </button>
          <button
            className={`rounded-xl py-2 transition-colors ${tab === "create" ? "bg-gold/20 text-gold" : "text-white/55"}`}
            onClick={() => setTab("create")}
          >
            Create room
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <input
            className={input}
            placeholder="Your username"
            maxLength={16}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          {tab === "join" && (
            <input
              className={`${input} text-center text-lg font-bold tracking-[0.4em] uppercase`}
              placeholder="CODE"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          )}

          {tab === "create" && (
            <div className="grid grid-cols-2 gap-2.5">
              <NumField label="Starting coins" value={cfg.startingCoins} min={50} onChange={(v) => setCfg({ ...cfg, startingCoins: v })} />
              <NumField label="Small blind" value={cfg.smallBlind} min={1} onChange={(v) => setCfg({ ...cfg, smallBlind: v })} />
              <NumField label="Big blind" value={cfg.bigBlind} min={2} onChange={(v) => setCfg({ ...cfg, bigBlind: v })} />
              <NumField label="Turn seconds" value={cfg.turnTimeSeconds} min={5} max={120} onChange={(v) => setCfg({ ...cfg, turnTimeSeconds: v })} />
            </div>
          )}

          <button
            disabled={busy}
            onClick={submit}
            className="w-full rounded-xl bg-gold py-3 text-sm font-black tracking-wide text-ink shadow-glowGold transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Connecting…" : tab === "join" ? "Take a seat" : "Open the table"}
          </button>
          <p className="text-center text-[10px] text-white/30">
            Virtual chips only — no real-money gambling.
          </p>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min = 1,
  max = 1_000_000,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/45">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl bg-black/35 px-3 py-2 text-sm tabnum ring-1 ring-white/12 focus:outline-none focus:ring-gold/50"
      />
    </label>
  );
}
