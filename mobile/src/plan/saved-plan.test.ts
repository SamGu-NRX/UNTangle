import { planningTerm } from "@/lib/planner-sections";

import { firstFittingSection, sectionsOf, weekOf, type Picks } from "./guest-plan";
import { samplePreferences } from "./preferences";
import { decodePlan, encodePlan, loadPlan, samplePlan, savePlan, withPicks, type GuestPlan, type PlanStorage } from "./saved-plan";

function memoryStorage(text: string | null = null): PlanStorage {
  let saved = text;
  return {
    read: () => saved,
    write: (next) => {
      saved = next;
    },
  };
}

function adding(plan: GuestPlan, code: string): GuestPlan {
  const section = firstFittingSection(code, plan.picks);
  if (!section) throw new Error(`${code} has no section that fits the plan`);
  return withPicks(plan, { ...plan.picks, [code]: section.id });
}

function removing(plan: GuestPlan, code: string): GuestPlan {
  const picks: Record<string, string> = { ...plan.picks };
  delete picks[code];
  return withPicks(plan, picks);
}

/** The hues Week draws for a plan, by course. */
const weekHues = (plan: GuestPlan) => Object.fromEntries(weekOf(plan.picks, plan.colors).colors);

describe("course colors", () => {
  it("keeps every other course's color when a course is added", () => {
    const before = samplePlan();
    const after = adding(before, "CSCE 1010");
    const hues = weekHues(after);
    for (const [code, hue] of Object.entries(weekHues(before))) expect([code, hues[code]]).toEqual([code, hue]);
    expect(hues["CSCE 1010"]).toEqual(expect.any(Number));
  });

  it("keeps every other course's color when a course is removed", () => {
    const before = adding(samplePlan(), "CSCE 1010");
    const after = removing(before, "CSCE 2100");
    const hues = weekHues(after);
    expect(hues["CSCE 2100"]).toBeUndefined();
    for (const [code, hue] of Object.entries(weekHues(before))) {
      if (code !== "CSCE 2100") expect([code, hues[code]]).toEqual([code, hue]);
    }
  });

  it("keeps the week's colors on an option that moves sections", () => {
    const plan = samplePlan();
    const other = sectionsOf("CSCE 2110").find((section) => section.id !== plan.picks["CSCE 2110"]);
    expect(other).toBeDefined();
    const moved: Picks = { ...plan.picks, "CSCE 2110": other!.id };
    expect(Object.fromEntries(weekOf(moved, plan.colors).colors)).toEqual(weekHues(plan));
  });
});

describe("saving the plan on the device", () => {
  it("shows the sample plan when nothing has been saved", () => {
    expect(loadPlan(memoryStorage())).toEqual({ plan: samplePlan(), problem: null });
  });

  it("brings a saved plan back after a reload, with its courses, preferences and colors", () => {
    const storage = memoryStorage();
    const plan = { ...adding(samplePlan(), "CSCE 1010"), prefs: { ...samplePreferences, maxCredits: 18, kept: ["MATH 2700"] } };
    savePlan(storage, plan);
    const { plan: loaded, problem } = loadPlan(storage);
    expect(problem).toBeNull();
    expect(loaded.picks).toEqual(plan.picks);
    expect(Object.keys(loaded.picks)).toEqual(Object.keys(plan.picks));
    expect(loaded.prefs).toEqual(plan.prefs);
    expect(Object.fromEntries(loaded.colors)).toEqual(Object.fromEntries(plan.colors));
  });

  it("keeps the colors after a course is removed and the app reloads", () => {
    const storage = memoryStorage();
    const plan = removing(samplePlan(), "CSCE 2100");
    savePlan(storage, plan);
    const hues = Object.fromEntries(loadPlan(storage).plan.colors);
    expect(hues).toEqual(Object.fromEntries(plan.colors));
    // Coloring the same courses from scratch gives CSCE 2110 the first hue: the saved colors are what keep it.
    expect(Object.fromEntries(withPicks({ ...plan, colors: new Map() }, plan.picks).colors)).not.toEqual(hues);
  });

  it("brings back a plan with every course removed, not the sample", () => {
    const storage = memoryStorage();
    savePlan(storage, withPicks(samplePlan(), {}));
    expect(loadPlan(storage).plan.picks).toEqual({});
  });

  it("falls back to the sample plan, and says why, when the saved text is not a plan", () => {
    const broken = loadPlan(memoryStorage("{not json"));
    expect(broken.plan).toEqual(samplePlan());
    expect(broken.problem).toMatch(/not JSON/);
  });

  it("does not load a plan saved for another term", () => {
    const record = JSON.parse(encodePlan(samplePlan()));
    expect(decodePlan(JSON.stringify({ ...record, term: "fall-2026" }))).toEqual({
      ok: false,
      reason: `it is for term fall-2026, not ${planningTerm.id}`,
    });
  });

  it("names the field that is the wrong shape", () => {
    const record = JSON.parse(encodePlan(samplePlan()));
    const leanings = { ...record.prefs.leanings, walking: "lots" };
    expect(decodePlan(JSON.stringify({ ...record, prefs: { ...record.prefs, leanings } }))).toEqual({
      ok: false,
      reason: "prefs.leanings.walking is not a whole step from 0 to 4",
    });
    expect(decodePlan(JSON.stringify({ ...record, colors: { "CSCE 2100": 9 } }))).toEqual({
      ok: false,
      reason: "colors is not a map of course codes to hues 1 to 6",
    });
  });

  it("rejects a leaning or credit limit Preferences can't show", () => {
    const record = JSON.parse(encodePlan(samplePlan()));
    const withPrefs = (prefs: object) => decodePlan(JSON.stringify({ ...record, prefs: { ...record.prefs, ...prefs } }));
    expect(withPrefs({ leanings: { ...record.prefs.leanings, rating: 5 } })).toEqual({
      ok: false,
      reason: "prefs.leanings.rating is not a whole step from 0 to 4",
    });
    expect(withPrefs({ leanings: { ...record.prefs.leanings, time: -1.5 } })).toEqual({
      ok: false,
      reason: "prefs.leanings.time is not a whole step from -2 to 2",
    });
    expect(withPrefs({ maxCredits: 40 })).toEqual({ ok: false, reason: "prefs.maxCredits is not a whole number from 3 to 21" });
  });

  it("leaves out a course whose saved section is gone, and keeps the rest", () => {
    const plan = samplePlan();
    const record = JSON.parse(encodePlan(plan));
    const loaded = loadPlan(memoryStorage(JSON.stringify({ ...record, picks: { ...record.picks, "MATH 2700": "math-2700-999" } })));
    expect(Object.keys(loaded.plan.picks)).toEqual(Object.keys(plan.picks).filter((code) => code !== "MATH 2700"));
    expect(loaded.problem).toMatch(/MATH 2700/);
  });

  it("falls back to the sample plan when the storage can't be read", () => {
    const failing: PlanStorage = {
      read: () => {
        throw new Error("disk is gone");
      },
      write: () => undefined,
    };
    const loaded = loadPlan(failing);
    expect(loaded.plan).toEqual(samplePlan());
    expect(loaded.problem).toMatch(/disk is gone/);
  });
});
