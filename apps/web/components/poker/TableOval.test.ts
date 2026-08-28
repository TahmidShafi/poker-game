import { describe, it, expect } from "vitest";
import { computeDesktopSeatPlacements, towardCenter } from "./TableOval";

describe("TableOval - Desktop Active Seat Compaction Geometry", () => {
  it("4-handed table with occupied seats 0, 3, 6, 8: seats are evenly spaced around the ellipse without clustering", () => {
    const seats = [
      { seatIndex: 0, username: "Alice" },
      { seatIndex: 1, username: null },
      { seatIndex: 2, username: null },
      { seatIndex: 3, username: "Bob" },
      { seatIndex: 4, username: null },
      { seatIndex: 5, username: null },
      { seatIndex: 6, username: "Charlie" },
      { seatIndex: 7, username: null },
      { seatIndex: 8, username: "David" },
      { seatIndex: 9, username: null },
    ];

    const { placements, occupiedCount } = computeDesktopSeatPlacements(seats, 0);

    expect(occupiedCount).toBe(4);
    expect(placements.size).toBe(4);

    // Hero (Seat 0): compactedRelIndex = 0, angle = 0 rad (0°)
    const seat0 = placements.get(0)!;
    expect(seat0.compactedRelIndex).toBe(0);
    expect(seat0.angle).toBeCloseTo(0, 5);
    expect(seat0.left).toBe("50%");
    expect(seat0.top).toBe("88%"); // 50 + cos(0)*38 = 88%

    // Seat 3: compactedRelIndex = 1, angle = (1/4)*2π = π/2 (90°)
    const seat3 = placements.get(3)!;
    expect(seat3.compactedRelIndex).toBe(1);
    expect(seat3.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(seat3.left).toBe("8%"); // 50 - sin(π/2)*42 = 8%
    expect(seat3.top).toBe("50%"); // 50 + cos(π/2)*38 = 50%

    // Seat 6: compactedRelIndex = 2, angle = (2/4)*2π = π (180°)
    const seat6 = placements.get(6)!;
    expect(seat6.compactedRelIndex).toBe(2);
    expect(seat6.angle).toBeCloseTo(Math.PI, 5);
    expect(seat6.left).toBe("50%"); // 50 - sin(π)*42 = 50%
    expect(seat6.top).toBe("12%"); // 50 + cos(π)*38 = 12% (Top Center)

    // Seat 8: compactedRelIndex = 3, angle = (3/4)*2π = 3π/2 (270°)
    const seat8 = placements.get(8)!;
    expect(seat8.compactedRelIndex).toBe(3);
    expect(seat8.angle).toBeCloseTo((3 * Math.PI) / 2, 5);
    expect(seat8.left).toBe("92%"); // 50 - sin(3π/2)*42 = 92%
    expect(seat8.top).toBe("50%"); // 50 + cos(3π/2)*38 = 50%

    // Verify angle delta between consecutive seats is uniformly 90°
    const angles = [seat0.angle, seat3.angle, seat6.angle, seat8.angle];
    for (let i = 0; i < angles.length; i++) {
      const nextAngle = i === angles.length - 1 ? 2 * Math.PI : angles[i + 1]!;
      expect(nextAngle - angles[i]!).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it("4-handed table when Hero is Seat 3: preserves Hero at bottom-center (compactedRelIndex 0)", () => {
    const seats = [
      { seatIndex: 0, username: "Alice" },
      { seatIndex: 3, username: "Bob" },
      { seatIndex: 6, username: "Charlie" },
      { seatIndex: 8, username: "David" },
    ];

    const { placements } = computeDesktopSeatPlacements(seats, 3);

    // Hero (Bob at Seat 3) must be at angle 0 (bottom-center)
    const hero = placements.get(3)!;
    expect(hero.compactedRelIndex).toBe(0);
    expect(hero.angle).toBeCloseTo(0, 5);
    expect(hero.left).toBe("50%");
    expect(hero.top).toBe("88%");

    // Next clockwise is Seat 6 (Charlie) at 90° (left)
    const next1 = placements.get(6)!;
    expect(next1.compactedRelIndex).toBe(1);
    expect(next1.angle).toBeCloseTo(Math.PI / 2, 5);

    // Next is Seat 8 (David) at 180° (top)
    const next2 = placements.get(8)!;
    expect(next2.compactedRelIndex).toBe(2);
    expect(next2.angle).toBeCloseTo(Math.PI, 5);

    // Next is Seat 0 (Alice) at 270° (right)
    const next3 = placements.get(0)!;
    expect(next3.compactedRelIndex).toBe(3);
    expect(next3.angle).toBeCloseTo((3 * Math.PI) / 2, 5);
  });

  it("2-handed Heads-Up table: opponent is placed directly opposite Hero at 180°", () => {
    const seats = [
      { seatIndex: 2, username: "HeroPlayer" },
      { seatIndex: 7, username: "VillainPlayer" },
    ];

    const { placements } = computeDesktopSeatPlacements(seats, 2);

    const hero = placements.get(2)!;
    expect(hero.compactedRelIndex).toBe(0);
    expect(hero.left).toBe("50%");
    expect(hero.top).toBe("88%");

    const opponent = placements.get(7)!;
    expect(opponent.compactedRelIndex).toBe(1);
    expect(opponent.angle).toBeCloseTo(Math.PI, 5);
    expect(opponent.left).toBe("50%");
    expect(opponent.top).toBe("12%"); // Top center
  });

  it("Dealer button position is interpolated inward along vector to table center", () => {
    const seatPos = { left: "8%", top: "50%" };
    const dealerPos = towardCenter(seatPos, 0.58);
    // left: 8 + (50 - 8) * 0.58 = 8 + 24.36 = 32.36%
    expect(parseFloat(dealerPos.left)).toBeCloseTo(32.36, 1);
    // top: 50 + (50 - 50) * 0.58 = 50%
    expect(parseFloat(dealerPos.top)).toBeCloseTo(50, 1);
  });

  it("Empty table returns 0 placements cleanly", () => {
    const { placements, occupiedCount } = computeDesktopSeatPlacements([], null);
    expect(occupiedCount).toBe(0);
    expect(placements.size).toBe(0);
  });
});
