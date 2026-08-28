import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getNotificationStatus,
  turnAlertsBlocked,
  requestTurnAlertPermission,
  requestTurnAlertPermissionOnce,
  beginTurnAlerts,
  endTurnAlerts,
  turnAlertsEnabled,
  setTurnAlertsEnabled,
} from "./notify";

describe("Notification Permission & Fallback Mechanics", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      length: store.size,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };

    globalThis.document = {
      title: "Texas Hold'em",
      hidden: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Document;

    endTurnAlerts();
  });

  it("reports 'unsupported' when Notification API is not available on the window", () => {
    // Delete Notification from window
    const originalNotification = (globalThis as any).Notification;
    delete (globalThis as any).Notification;

    expect(getNotificationStatus()).toBe("unsupported");
    expect(turnAlertsBlocked()).toBe(true);

    // beginTurnAlerts still safely arms title-flash without throwing
    expect(() => beginTurnAlerts({ roomCode: "P99", seconds: 15 })).not.toThrow();
    expect(() => endTurnAlerts()).not.toThrow();

    (globalThis as any).Notification = originalNotification;
  });

  it("reports 'denied' and sets turnAlertsBlocked to true when permission is denied", () => {
    (globalThis as any).Notification = {
      permission: "denied",
      requestPermission: vi.fn().mockResolvedValue("denied"),
    };

    expect(getNotificationStatus()).toBe("denied");
    expect(turnAlertsBlocked()).toBe(true);

    // Title flash fallback runs cleanly
    expect(() => beginTurnAlerts({ roomCode: "P99", seconds: 15 })).not.toThrow();
  });

  it("reports 'granted' and allows notification requests when permission is granted", async () => {
    (globalThis as any).Notification = {
      permission: "granted",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    };

    expect(getNotificationStatus()).toBe("granted");
    expect(turnAlertsBlocked()).toBe(false);
    expect(await requestTurnAlertPermission()).toBe(true);
  });

  it("requestTurnAlertPermissionOnce prompts on 'default' and sets localStorage flag", async () => {
    const requestMock = vi.fn().mockResolvedValue("granted");
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: requestMock,
    };

    const res1 = await requestTurnAlertPermissionOnce();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("poker.notificationPrompted")).toBe("1");

    // Second call should not prompt again
    const res2 = await requestTurnAlertPermissionOnce();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
