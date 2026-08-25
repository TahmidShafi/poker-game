"use client";

/**
 * "Your turn" attention alerts for when the tab is NOT visible:
 *  - tab-title flash  "(✔ YOUR TURN) …"
 *  - OS notification (Notification API, tag-collapsed, auto-close)
 *  - mobile vibration (navigator.vibrate)
 *
 * Sound is handled separately by lib/sound.ts (always plays).
 * Alerts arm at turn start; if the tab becomes hidden mid-turn they fire
 * then too. Everything is torn down by endTurnAlerts().
 */

const ALERTS_KEY = "poker.turnAlerts";

export function turnAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ALERTS_KEY) === "1";
}

export function setTurnAlertsEnabled(on: boolean): void {
  localStorage.setItem(ALERTS_KEY, on ? "1" : "0");
}

/** Must be called from a user gesture (gear-menu toggle). */
export async function requestTurnAlertPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

export function turnAlertsBlocked(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "denied"
  );
}

let flashTimer: ReturnType<typeof setInterval> | null = null;
let originalTitle = "";
let activeNotification: Notification | null = null;
let visibilityHandler: (() => void) | null = null;

function closeNotification(): void {
  if (activeNotification) {
    try {
      activeNotification.close();
    } catch {
      /* already gone */
    }
    activeNotification = null;
  }
}

function stopTitleFlash(): void {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  if (originalTitle && document.title !== originalTitle) {
    document.title = originalTitle;
  }
}

function arm(info: { roomCode: string; seconds: number }): void {
  // Title flash
  if (flashTimer === null && originalTitle) {
    const prefix = "\u2705 YOUR TURN";
    let flip = false;
    flashTimer = setInterval(() => {
      document.title = flip ? originalTitle : `${prefix} \u00b7 ${originalTitle}`;
      flip = !flip;
    }, 900);
  }
  // OS notification
  if (!activeNotification && "Notification" in window && Notification.permission === "granted") {
    try {
      activeNotification = new Notification("Your turn!", {
        body: `Room ${info.roomCode} \u00b7 act within ~${info.seconds}s`,
        tag: "poker-turn",
        silent: true,
      });
      activeNotification.onclose = () => {
        activeNotification = null;
      };
      setTimeout(closeNotification, 8000);
    } catch {
      /* some browsers throw without a service worker */
    }
  }
  // Vibration
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate([120, 60, 120]);
  }
}

/** Arm alerts for the current turn (no-op unless enabled). */
export function beginTurnAlerts(info: { roomCode: string; seconds: number }): void {
  endTurnAlerts();
  if (!turnAlertsEnabled() || typeof document === "undefined") return;
  originalTitle = document.title;

  visibilityHandler = () => {
    if (document.hidden) arm(info);
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  if (document.hidden) arm(info);
}

/** Tear down every alert artifact. Safe to call repeatedly. */
export function endTurnAlerts(): void {
  stopTitleFlash();
  closeNotification();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}
