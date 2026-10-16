import { describe, expect, test } from "bun:test";
import { chooseDetent, projectMomentum, releaseVelocity, resistedHeight, rubberband, sheetHeights } from "@/components/map/sheet-physics";

const detents = [120, 400, 740]; // peek, half, full

describe("chooseDetent", () => {
  test("a slow release lands on the nearest detent", () => {
    expect(chooseDetent(250, 0, detents)).toBe(0);
    expect(chooseDetent(300, 0.05, detents)).toBe(1);
  });

  test("momentum carries a release toward where it was heading", () => {
    // 1 px/ms upward from just above peek projects ~500 px: past half, nearest full.
    expect(chooseDetent(140, 1, detents)).toBe(2);
  });

  test("a flick always moves at least one detent in its direction", () => {
    // Barely past the flick threshold from half, upward: the projection (~60 px) stays nearest half.
    expect(chooseDetent(400, 0.12, detents)).toBe(2);
    expect(chooseDetent(400, -0.12, detents)).toBe(0);
  });

  test("a flick past the last detent stays on it", () => {
    expect(chooseDetent(740, 2, detents)).toBe(2);
  });

  test("needs detents", () => {
    expect(() => chooseDetent(0, 0, [])).toThrow();
  });
});

describe("resistance", () => {
  test("inside the range the sheet follows the finger exactly", () => {
    expect(resistedHeight(500, 120, 740, 800)).toBe(500);
  });

  test("past an edge it follows less and less", () => {
    const small = resistedHeight(760, 120, 740, 800) - 740;
    const large = resistedHeight(940, 120, 740, 800) - 740;
    expect(small).toBeLessThan(20);
    expect(large).toBeLessThan(200 * 0.55);
    expect(large / 200).toBeLessThan(small / 20);
    expect(rubberband(-50, 800)).toBeLessThan(0);
  });
});

describe("projectMomentum and releaseVelocity", () => {
  test("projection matches Apple's formula at 0.998", () => {
    expect(projectMomentum(1)).toBeCloseTo(499, 0);
    expect(projectMomentum(0)).toBe(0);
  });

  test("velocity uses about the last 100 ms of samples", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 400, y: 0 },
      { t: 450, y: 25 },
      { t: 500, y: 50 },
    ];
    // From t=400 to t=500: 50 px in 100 ms.
    expect(releaseVelocity(samples)).toBeCloseTo(0.5, 5);
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0);
  });
});

describe("sheetHeights", () => {
  // https://github.com/SamGu-NRX/UNTangle/pull/25#discussion_r4259595855
  test("a short map area keeps half below full", () => {
    // The reported case: before, half was 142 and full 138.
    const { peek, half, full } = sheetHeights(150, 112, 138);
    expect(full).toBe(138);
    expect(peek).toBe(62);
    expect(half).toBe(100);
  });

  test("detents stay ordered across short areas and tall headers", () => {
    for (let area = 40; area <= 1000; area += 7) {
      for (const header of [60, 112, 224, 400]) {
        for (const full of [area * 0.92, area - 120, 0]) {
          const { peek, half, full: top } = sheetHeights(area, header, Math.max(0, full));
          expect(peek).toBeLessThanOrEqual(half);
          expect(half).toBeLessThanOrEqual(top);
        }
      }
    }
  });

  test("a phone-sized area keeps the designed half", () => {
    // 390x844 with the shell's bars leaves about 700px of map.
    expect(sheetHeights(700, 112, 644)).toEqual({ peek: 112, half: 350, full: 644 });
  });

  test("half keeps its 320px floor when the area has room for it", () => {
    // Half of a 600px area is 300; the midpoint (330) leaves room for 320.
    expect(sheetHeights(600, 112, 548).half).toBe(320);
  });

  test("full is the caller's measured height", () => {
    // Day measures full below the stepper and the attribution row.
    expect(sheetHeights(700, 112, 590.6).full).toBe(591);
  });
});
