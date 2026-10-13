import { describe, expect, test } from "bun:test";
import { placeFloating } from "@/components/ui/anchored";
import { firstEnabled, lastEnabled, stepEnabled, typeaheadMatch } from "@/components/ui/listbox-nav";
import { nextEnabledWrapping } from "@/components/ui/Segmented";
import {
  dampedOffset,
  detentHeight,
  detentOffsets,
  releaseTarget,
  releaseVelocity,
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

  test("detents resolve against the viewport", () => {
    expect(heights).toEqual([112, 422, 776.48]);
    expect(max).toBe(776.48);
    expect(offsets[2]).toBe(0);
  });

  test("dragging above the top detent is damped by 0.3", () => {
    expect(dampedOffset(-100)).toBeCloseTo(-30);
    expect(dampedOffset(40)).toBe(40);
  });

  test("a downward flick drops one detent, and from the lowest dismisses", () => {
    expect(releaseTarget({ offset: offsets[2] + 20, velocity: 0.5, offsets, max, dismissible: true })).toBe(1);
    expect(releaseTarget({ offset: offsets[0] + 5, velocity: 0.2, offsets, max, dismissible: true })).toBe("dismiss");
    expect(releaseTarget({ offset: offsets[0] + 5, velocity: 0.2, offsets, max, dismissible: false })).toBe(0);
  });

  test("an upward flick rises one detent", () => {
    expect(releaseTarget({ offset: offsets[1] - 10, velocity: -0.3, offsets, max, dismissible: true })).toBe(2);
    expect(releaseTarget({ offset: offsets[0] - 10, velocity: -0.3, offsets, max, dismissible: true })).toBe(1);
  });

  test("a slow release settles on the nearest place, including closed", () => {
    expect(releaseTarget({ offset: offsets[1] + 30, velocity: 0.05, offsets, max, dismissible: true })).toBe(1);
    expect(releaseTarget({ offset: max - 20, velocity: 0, offsets, max, dismissible: true })).toBe("dismiss");
    expect(releaseTarget({ offset: max - 20, velocity: 0, offsets, max, dismissible: false })).toBe(0);
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
