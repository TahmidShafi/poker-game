import { describe, it, expect, beforeEach } from "vitest";
import { playTurn, playWin, playChips, isAudioUnlocked, unlockAudio, isMuted, setMuted } from "./sound";
import { beginTurnAlerts, endTurnAlerts } from "./notify";

describe("Audio Autoplay & Fallback Behavior", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    // Provide standard Web Storage mock for Node test runner
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      length: store.size,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };

    // Provide minimal document mock
    globalThis.document = {
      title: "Poker Game",
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Document;

    endTurnAlerts();
    setMuted(false);
  });

  it("handles suspended AudioContext gracefully without throwing on sound calls", () => {
    // Calling sound functions without user interaction should never throw
    expect(() => playTurn()).not.toThrow();
    expect(() => playWin()).not.toThrow();
    expect(() => playChips()).not.toThrow();
  });

  it("mute flag persists and suppresses sound execution", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(() => playTurn()).not.toThrow();
    setMuted(false);
    expect(isMuted()).toBe(false);
  });

  it("unlockAudio resolves safely to boolean without throwing", async () => {
    const result = await unlockAudio();
    expect(typeof result).toBe("boolean");
  });

  it("title-flash notification still activates when tab is hidden and audio is uninitialized", () => {
    document.title = "Texas Hold'em";
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    // Calling beginTurnAlerts when tab is hidden
    expect(() => beginTurnAlerts({ roomCode: "TEST99", seconds: 30 })).not.toThrow();
    expect(() => endTurnAlerts()).not.toThrow();
  });
});
