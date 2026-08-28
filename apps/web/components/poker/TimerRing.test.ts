import { describe, it, expect } from "vitest";
import { getTimerUrgency, getTimerIcon } from "./TimerRing";

describe("TimerRing Accessibility & Urgency Tiers", () => {
  it("classifies >10s remaining as normal with clock icon", () => {
    expect(getTimerUrgency(15000)).toBe("normal");
    expect(getTimerUrgency(10000)).toBe("normal");
    expect(getTimerIcon("normal")).toBe("⏱");
  });

  it("classifies 5s-10s remaining as warning with warning icon", () => {
    expect(getTimerUrgency(9999)).toBe("warning");
    expect(getTimerUrgency(7500)).toBe("warning");
    expect(getTimerUrgency(5000)).toBe("warning");
    expect(getTimerIcon("warning")).toBe("⚠");
  });

  it("classifies <5s remaining as urgent with exclamation icon", () => {
    expect(getTimerUrgency(4999)).toBe("urgent");
    expect(getTimerUrgency(1000)).toBe("urgent");
    expect(getTimerUrgency(100)).toBe("urgent");
    expect(getTimerIcon("urgent")).toBe("!");
  });

  it("returns normal when timer is 0 or negative", () => {
    expect(getTimerUrgency(0)).toBe("normal");
    expect(getTimerUrgency(-500)).toBe("normal");
  });
});
