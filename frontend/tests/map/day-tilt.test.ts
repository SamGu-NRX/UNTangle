import { describe, expect, test } from "bun:test";
import { dayTilt } from "@/components/map/day-tilt";

describe("day tilt", () => {
  test("3D off stays flat through compact-day reframes until the choice is cleared", () => {
    expect(dayTilt({ automatic: true, choice: null, reducedMotion: false })).toBe(true);
    for (let reframe = 0; reframe < 3; reframe += 1) {
      expect(dayTilt({ automatic: true, choice: false, reducedMotion: false })).toBe(false);
    }
    // A new day clears the choice and uses its own opening default.
    expect(dayTilt({ automatic: true, choice: null, reducedMotion: false })).toBe(true);
    expect(dayTilt({ automatic: false, choice: null, reducedMotion: false })).toBe(false);
  });

  test("3D on overrides a flat default, while another toggle or reduced motion flattens it", () => {
    expect(dayTilt({ automatic: false, choice: true, reducedMotion: false })).toBe(true);
    expect(dayTilt({ automatic: false, choice: false, reducedMotion: false })).toBe(false);
    for (const automatic of [true, false]) {
      for (const choice of [null, true, false]) {
        expect(dayTilt({ automatic, choice, reducedMotion: true })).toBe(false);
      }
    }
  });
});
