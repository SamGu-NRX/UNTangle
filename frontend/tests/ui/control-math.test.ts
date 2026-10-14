import { describe, expect, test } from "bun:test";
import { placeFloating } from "@/components/ui/anchored";
import { firstEnabled, lastEnabled, stepEnabled, typeaheadMatch } from "@/components/ui/listbox-nav";
import { nextEnabledWrapping } from "@/components/ui/Segmented";
import {
  EXIT,
  FLICK,
  SETTLE,
  detentHeight,
  detentOffsets,
  projectedOffset,
  releaseTarget,
  releaseVelocity,
  rubberBand,
  springSettled,
  springStep,
  type Spring,
} from "@/components/ui/sheet-physics";
import { moveRangeThumb, nearestThumb, snap, valueForKey, valueFromRatio } from "@/components/ui/slider-math";

describe("slider math", () => {
  const bounds = { min: 2, max: 20, step: 1 };

  test("arrows step by one, Shift and Page keys by five, Home/End to the ends", () => {
    expect(valueForKey(10, "ArrowRight", false, bounds)).toBe(11);
    expect(valueForKey(10, "ArrowDown", false, bounds)).toBe(9);
    expect(valueForKey(10, "ArrowUp", true, bounds)).toBe(15);
    expect(valueForKey(10, "PageDown", false, bounds)).toBe(5);
    expect(valueForKey(10, "Home", false, bounds)).toBe(2);
    expect(valueForKey(10, "End", false, bounds)).toBe(20);
    expect(valueForKey(10, "a", false, bounds)).toBeNull();
  });

  test("steps clamp at the bounds", () => {
    expect(valueForKey(19, "ArrowRight", true, bounds)).toBe(20);
    expect(valueForKey(3, "ArrowLeft", true, bounds)).toBe(2);
  });

  test("fractional steps snap without float drift", () => {
    const half = { min: 7, max: 21, step: 0.5 };
    expect(snap(9.26, half)).toBe(9.5);
    expect(valueForKey(9.5, "ArrowRight", false, half)).toBe(10);
    expect(snap(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });

  test("precision follows the minimum as well as the step", () => {
    const offset = { min: 0.5, max: 10, step: 1 };
    expect(snap(0.5, offset)).toBe(0.5);
    expect(valueForKey(0.5, "ArrowRight", false, offset)).toBe(1.5);
  });

  test("pointer ratio maps onto the step grid and clamps", () => {
    expect(valueFromRatio(0.5, bounds)).toBe(11);
    expect(valueFromRatio(-0.2, bounds)).toBe(2);
    expect(valueFromRatio(1.4, bounds)).toBe(20);
  });

  test("range thumbs never cross and keep the minimum gap", () => {
    expect(moveRangeThumb([9, 15], 0, 16, 1)).toEqual([14, 15]);
    expect(moveRangeThumb([9, 15], 1, 3, 1)).toEqual([9, 10]);
    expect(moveRangeThumb([9, 15], 0, 8, 1)).toEqual([8, 15]);
  });

  test("a press grabs the nearer thumb", () => {
    expect(nearestThumb([9, 15], 10)).toBe(0);
    expect(nearestThumb([9, 15], 14)).toBe(1);
    expect(nearestThumb([9, 15], 20)).toBe(1);
    expect(nearestThumb([9, 15], 1)).toBe(0);
  });
});

describe("listbox navigation", () => {
  const options = [
    { label: "All instructors" },
    { label: "R. Okafor" },
    { label: "M. Delgado", disabled: true },
    { label: "S. Whitfield" },
    { label: "Sam Lee" },
  ];

  test("steps skip disabled options and stop at the ends", () => {
    expect(stepEnabled(options, 1, 1)).toBe(3);
    expect(stepEnabled(options, 3, -1)).toBe(1);
    expect(stepEnabled(options, 4, 1)).toBe(4);
    expect(stepEnabled(options, 0, -1)).toBe(0);
    expect(firstEnabled(options)).toBe(0);
    expect(lastEnabled([{ label: "a" }, { label: "b", disabled: true }])).toBe(0);
  });

  test("typeahead finds the next match and a repeated letter cycles", () => {
    expect(typeaheadMatch(options, "s", 0)).toBe(3);
    expect(typeaheadMatch(options, "ss", 3)).toBe(4);
    expect(typeaheadMatch(options, "sa", 3)).toBe(4);
    expect(typeaheadMatch(options, "s.", 0)).toBe(3);
    expect(typeaheadMatch(options, "m", 0)).toBe(-1);
    expect(typeaheadMatch(options, "", 0)).toBe(-1);
  });
});

describe("segmented navigation", () => {
  test("wraps and skips disabled segments", () => {
    const disabled = [false, false, false, false, true];
    expect(nextEnabledWrapping(disabled, 3, 1)).toBe(0);
    expect(nextEnabledWrapping(disabled, 0, -1)).toBe(3);
    expect(nextEnabledWrapping(disabled, -1, 1)).toBe(0);
    expect(nextEnabledWrapping([true, true], 0, 1)).toBe(0);
  });
});

describe("bottom sheet physics", () => {
  const vh = 844;
  const heights = [112, "50%", "92%"].map((d) => detentHeight(d as 112 | `${number}%`, vh));
  const { max, offsets } = detentOffsets(heights);
  const [peek, half, top] = offsets;
  const release = (offset: number, velocity: number, dismissible = true) => releaseTarget({ offset, velocity, offsets, dismissible });

  test("detents resolve against the viewport", () => {
    expect(heights).toEqual([112, 422, 776.48]);
    expect(max).toBe(776.48);
    expect(offsets).toEqual([664.48, 354.48, 0]);
  });

  test("past the top detent the sheet rubber-bands as o * d * 0.55 / (d + 0.55 * |o|)", () => {
    expect(rubberBand(0, vh)).toBe(0);
    expect(rubberBand(100, vh)).toBeCloseTo((100 * vh * 0.55) / (vh + 55), 10);
    // It never stops dead, and however far the pull, it stays under one viewport.
    expect(rubberBand(400, vh)).toBeGreaterThan(rubberBand(200, vh));
    expect(rubberBand(1e6, vh)).toBeLessThan(vh);
  });

  test("a release projects v * 0.995 / 0.005, about 199ms of travel", () => {
    expect(projectedOffset(100, 0.5)).toBeCloseTo(199.5, 10);
    expect(projectedOffset(100, -0.5)).toBeCloseTo(0.5, 10);
  });

  test("a slow release settles on the detent nearest the projection", () => {
    expect(release(half + 30, 0)).toBe(1);
    expect(release(half - 140, 0)).toBe(1);
    expect(release(half - 200, 0)).toBe(2);
  });

  test("momentum picks the detent: a fast flick from the top carries past half", () => {
    expect(release(top + 10, 2)).toBe(1); // projected 408, nearest half
    expect(release(top + 10, 3.5)).toBe(0); // projected 706.5, nearest peek
  });

  test("a flick moves at least one detent past where the sheet is", () => {
    expect(release(top + 20, 0.2)).toBe(1); // projection alone would stay at the top
    expect(release(half - 10, -0.3)).toBe(2);
    expect(release(peek - 10, -0.12)).toBe(1);
  });

  test("a dismissible sheet closes 80px past the lowest detent, or on a flick down from it", () => {
    expect(release(peek + 70, 0.1)).toBe("dismiss"); // projected 754.4 > 744.48
    expect(release(peek + 70, 0)).toBe(0); // 734.48 stays short of the line
    expect(release(peek + 5, 0.2)).toBe("dismiss");
    expect(release(peek + 5, 0.2, false)).toBe(0);
    expect(release(peek + 200, 0, false)).toBe(0);
  });

  const run = (spring: Spring, from: number, to: number, v0 = 0) => {
    let state = { x: from, v: v0 };
    let peak = from;
    for (let frame = 1; frame <= 120; frame += 1) {
      state = springStep(state, to, 1 / 60, spring);
      peak = Math.max(peak, state.x);
      if (springSettled(state, to)) return { frames: frame, peak };
    }
    return { frames: Infinity, peak };
  };

  test("the settle spring is critically damped: it never passes its target", () => {
    const { frames, peak } = run(SETTLE, 0, 300);
    expect(peak).toBeLessThanOrEqual(300.5);
    expect(frames).toBeLessThan(60); // under a second
  });

  test("the flick spring keeps a small bounce and still settles", () => {
    const { frames, peak } = run(FLICK, 0, 300, 1500);
    expect(peak).toBeGreaterThan(300);
    expect(peak).toBeLessThan(330);
    expect(frames).toBeLessThan(60);
  });

  test("the exit spring settles faster than the settle spring", () => {
    expect(run(EXIT, 0, 300).frames).toBeLessThan(run(SETTLE, 0, 300).frames);
  });

  test("a long frame is clamped to 32ms, so a hitch cannot destabilise the spring", () => {
    expect(springStep({ x: 0, v: 0 }, 100, 1, SETTLE)).toEqual(springStep({ x: 0, v: 0 }, 100, 0.032, SETTLE));
  });

  test("velocity reads the last 100ms, so a pause before release is no flick", () => {
    const flick = [
      { y: 0, t: 0 },
      { y: 30, t: 50 },
      { y: 60, t: 100 },
    ];
    expect(releaseVelocity(flick)).toBeCloseTo(0.6);
    // Only the release sample falls inside the window: no measurable speed.
    const paused = [...flick, { y: 61, t: 300 }];
    expect(releaseVelocity(paused)).toBe(0);
    const slowDrift = [...flick, { y: 62, t: 160 }, { y: 64, t: 200 }];
    expect(releaseVelocity(slowDrift)).toBeCloseTo(0.04);
    expect(releaseVelocity([{ y: 0, t: 0 }])).toBe(0);
  });
});

describe("placeFloating", () => {
  const viewport = { width: 1440, height: 900 };
  const anchor = { left: 100, top: 100, right: 300, bottom: 136, width: 200, height: 36 };

  test("opens below, aligned to the trigger's start, origin at the trigger", () => {
    const p = placeFloating(anchor, { width: 240, height: 200 }, viewport);
    expect(p).toMatchObject({ x: 100, y: 140, side: "bottom", originX: 0, originY: 0 });
  });

  test("end alignment puts the origin at the trigger's right edge", () => {
    const p = placeFloating(anchor, { width: 240, height: 200 }, viewport, { align: "end" });
    expect(p.x).toBe(60);
    expect(p.originX).toBe(240);
  });

  test("flips above when there is no room below", () => {
    const low = { ...anchor, top: 800, bottom: 836 };
    const p = placeFloating(low, { width: 240, height: 200 }, viewport);
    expect(p.side).toBe("top");
    expect(p.y).toBe(800 - 4 - 200);
    expect(p.originY).toBe(200);
  });

  test("clamps inside the viewport edge", () => {
    const right = { ...anchor, left: 1400, right: 1430 };
    expect(placeFloating(right, { width: 240, height: 100 }, viewport).x).toBe(1440 - 240 - 8);
  });
});
