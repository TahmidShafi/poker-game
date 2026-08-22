"use client";

/**
 * Tiny WebAudio SFX engine — synthesized, no asset downloads.
 * Persisted mute flag in localStorage.
 */

const MUTE_KEY = "poker.muted";

export function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, delaySec: number, durSec: number, type: OscillatorType = "sine", gain = 0.07): void {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delaySec;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durSec + 0.02);
}

/** Your turn — short double ping. */
export function playTurn(): void {
  if (isMuted()) return;
  tone(740, 0, 0.09);
  tone(988, 0.09, 0.11);
}

/** You won a pot — little arpeggio. */
export function playWin(): void {
  if (isMuted()) return;
  [523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.16, "triangle", 0.06));
}

/** Chips moving — soft low click (loans/repay/bets). */
export function playChips(): void {
  if (isMuted()) return;
  tone(190, 0, 0.05, "square", 0.05);
  tone(240, 0.05, 0.05, "square", 0.04);
}
