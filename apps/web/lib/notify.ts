"use client";

/**
 * "Your turn" attention alerts for when the tab is NOT visible:
 *  - tab-title flash  "(✔ YOUR TURN) …"
 *  - OS notification (Notification API, tag-collapsed, auto-close)
 *  - mobile vibration (navigator.vibrate)
 *
 * Sound is handled separately by lib/sound.ts (safe no-throw audio).
 * Gracefully degrades to title-flash and audio/visual cues if Notification
 * permission is denied, unsupported (e.g. iOS Safari pre-16.4), or blocked.
 */

const ALERTS_KEY = "poker.turnAlerts";
const PROMPTED_KEY = "poker.notificationPrompted";

export type NotificationStatus = "granted" | "denied" | "default" | "unsupported";

export function getNotificationStatus(): NotificationStatus {
  if (typeof Notification !== "undefined") {
    return Notification.permission;
  }
  if (typeof window !== "undefined" && "Notification" in window) {
    return (window as any).Notification.permission;
  }
  return "unsupported";
}

export function turnAlertsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const val = localStorage.getItem(ALERTS_KEY);
    return val === null || val === "1";
  } catch {
    return true;
  }
}

export function setTurnAlertsEnabled(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ALERTS_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** Must be called from a user gesture (e.g. join/create room or settings toggle). */
export async function requestTurnAlertPermission(): Promise<boolean> {
  const status = getNotificationStatus();
  if (status === "unsupported") return false;
  if (status === "granted") return true;
  if (status === "denied") return false;
  try {
    const NotificationApi = typeof Notification !== "undefined" ? Notification : (window as any).Notification;
    const res = await NotificationApi.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/** One-time prompt tied to user joining or creating a table. */
export async function requestTurnAlertPermissionOnce(): Promise<boolean> {
  if (typeof localStorage === "undefined") return false;
  const status = getNotificationStatus();
  if (status !== "default") return status === "granted";
  try {
    if (localStorage.getItem(PROMPTED_KEY) === "1") return false;
    localStorage.setItem(PROMPTED_KEY, "1");
    return await requestTurnAlertPermission();
  } catch {
    return false;
  }
}

export function turnAlertsBlocked(): boolean {
  const status = getNotificationStatus();
  return status === "denied" || status === "unsupported";
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
  if (originalTitle && typeof document !== "undefined" && document.title !== originalTitle) {
    document.title = originalTitle;
  }
}

function arm(info: { roomCode: string; seconds: number }): void {
  if (typeof document === "undefined") return;

  // Title flash — ALWAYS runs when tab is hidden, regardless of Notification support
  if (flashTimer === null) {
    const titleBase = originalTitle || document.title || "Texas Hold'em";
    const prefix = "✔ YOUR TURN";
    let flip = false;
    flashTimer = setInterval(() => {
      document.title = flip ? titleBase : `${prefix} · ${titleBase}`;
      flip = !flip;
    }, 900);
  }

  // OS notification (ONLY when explicitly granted and supported)
  const status = getNotificationStatus();
  if (status === "granted" && !activeNotification) {
    try {
      const NotificationApi = typeof Notification !== "undefined" ? Notification : (window as any).Notification;
      const notif = new NotificationApi("Your turn!", {
        body: `Room ${info.roomCode} · act within ~${info.seconds}s`,
        tag: "poker-turn",
        silent: true,
      });
      notif.onclose = () => {
        if (activeNotification === notif) {
          activeNotification = null;
        }
      };
      activeNotification = notif;
      setTimeout(closeNotification, 8000);
    } catch {
      /* some browsers / contexts throw without service worker */
    }
  }

  // Vibration (mobile devices supporting navigator.vibrate)
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([120, 60, 120]);
    } catch {
      /* ignore vibration failure */
    }
  }
}

/** Arm alerts for the current turn (no-op unless enabled or active). */
export function beginTurnAlerts(info: { roomCode: string; seconds: number }): void {
  endTurnAlerts();
  if (typeof document === "undefined") return;
  if (!turnAlertsEnabled()) return;

  originalTitle = document.title || "Texas Hold'em";

  visibilityHandler = () => {
    if (document.hidden) {
      arm(info);
    } else {
      stopTitleFlash();
      closeNotification();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  if (document.hidden) {
    arm(info);
  }
}

/** Tear down every alert artifact. Safe to call repeatedly. */
export function endTurnAlerts(): void {
  stopTitleFlash();
  closeNotification();
  if (typeof document !== "undefined" && visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}
