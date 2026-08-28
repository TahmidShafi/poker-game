"use client";

/**
 * Tiny WebAudio SFX engine — synthesized, no asset downloads.
 * Persisted mute flag in localStorage.
 * Handles browser autoplay / suspended AudioContext policies gracefully.
 */

const MUTE_KEY = "poker.muted";

export function isMuted(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

let ctx: AudioContext | null = null;
let audioStateListeners: Set<(unlocked: boolean) => void> = new Set();

export function isAudioUnlocked(): boolean {
  if (!ctx) return false;
  return ctx.state === "running";
}

export function subscribeAudioState(listener: (unlocked: boolean) => void): () => void {
  audioStateListeners.add(listener);
  listener(isAudioUnlocked());
  return () => {
    audioStateListeners.delete(listener);
  };
}

function notifyState(): void {
  const unlocked = isAudioUnlocked();
  for (const listener of audioStateListeners) {
    try {
      listener(unlocked);
    } catch {
      /* ignore subscriber error */
    }
  }
}

export function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    if (ctx.onstatechange !== undefined) {
      ctx.onstatechange = () => notifyState();
    }
  }
  return ctx;
}

/**
 * Explicitly resumes the AudioContext on user interaction.
 * Never throws, resolves to boolean indicating if audio is running.
 */
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      // Browser blocked resume (no user gesture yet) — fail silently
    }
  }
  notifyState();
  return c.state === "running";
}

// Auto-register window-level interaction listener to unlock early on any click/tap/keypress
if (typeof window !== "undefined") {
  const handleEarlyInteraction = () => {
    void unlockAudio().then((unlocked) => {
      if (unlocked) {
        window.removeEventListener("pointerdown", handleEarlyInteraction);
        window.removeEventListener("keydown", handleEarlyInteraction);
        window.removeEventListener("touchstart", handleEarlyInteraction);
      }
    });
  };
  window.addEventListener("pointerdown", handleEarlyInteraction, { passive: true });
  window.addEventListener("keydown", handleEarlyInteraction, { passive: true });
  window.addEventListener("touchstart", handleEarlyInteraction, { passive: true });
}

function tone(
  freq: number,
  delaySec: number,
  durSec: number,
  type: OscillatorType = "sine",
  gain = 0.07
): void {
  try {
    const c = ensureCtx();
    if (!c || c.state !== "running") {
      // AudioContext suspended or unavailable — skip sound gracefully
      return;
    }
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
  } catch {
    // Gracefully ignore any synthesis exceptions without blocking
  }
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
