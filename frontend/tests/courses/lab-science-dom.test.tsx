/**
 * Laboratory science's detail (PR #168 review): "choose 2" counts selections,
 * and its options differ in what they fill. BIOL 1710 with BIOL 1760 fills
 * one; adding BIOL 1720 fills both. The panel says selections, not courses,
 * and each option says what it fills. Real 2026-2027 data, rendered in the DOM.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { buildCourseModel } from "@/components/courses/model/course-model";
import { checkDegree, countsSelections, fillsText, withDegree } from "@/components/courses/model/degree";
import { snapshotOf } from "@/components/courses/model/plan-edits";
import { untProfile } from "@/components/courses/school";
import { getMajorById } from "@/lib/planner";
import type { TranscriptCourseRecord } from "@/lib/types";
import { installDom, mount, removeDom } from "../ui/dom";
import { plannerWith, row } from "./degree-students";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

beforeAll(() => installDom());
afterAll(() => removeDom());

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";

async function labScience(transcript: readonly TranscriptCourseRecord[]) {
  const { RequirementDetail } = await import("@/components/courses/RequirementDetail");
  const profile = untProfile();
  const snapshot = snapshotOf(plannerWith(transcript, "cs"));
  const base = buildCourseModel(profile, snapshot);
  const degree = checkDegree(profile, snapshot, base, getMajorById("cs")!);
  if (degree.kind !== "audited") throw new Error(`expected an audited degree, got ${degree.kind}`);
  const requirement = degree.areas.flatMap((area) => area.requirements).find((entry) => entry.name === "Laboratory science");
  if (!requirement) throw new Error("Laboratory science is not left");
  const view = await mount(<RequirementDetail entry={{ kind: "requirement", requirement, areaTitle: "Computer Science, BS" }} model={withDegree(base, degree)} />);
  /** Each listed option: its courses, then what it fills, and whether that finishes the requirement. */
  const options = () =>
    [...view.container.querySelectorAll("li")].map((li) => ({
      // After the glyph: a course's code, or a set's codes as a sentence.
      courses: text(li.children[1]),
      fills: text(li.querySelector(".reqFills")),
      finishes: li.querySelector(".reqFills")?.hasAttribute("data-finishes") ?? false,
    }));
  return { view, options };
}

describe("Laboratory science's options say what they fill", () => {
  test("with nothing taken: 2 selections, and only BIOL 1710, 1720 and 1760 together fill both", async () => {
    const { view, options } = await labScience([]);
    try {
      expect(text(view.container.querySelector(".detailStatus"))).toBe("Still needs 2 selections");
      expect([...view.container.querySelectorAll(".reqLead")].map(text)).toEqual(["2 more selections from these:", "Or one of these:", "Or one of these:"]);
      const listed = options();
      // Every option says what it fills, single courses and sets alike.
      expect(listed.every((option) => option.fills !== "")).toBe(true);
      const biol = listed.filter((option) => option.courses.includes("BIOL 1760"));
      expect(biol.map(({ courses, fills, finishes }) => [courses, fills, finishes])).toEqual([
        ["BIOL 1710 and BIOL 1760", "Fills 1 of 2 selections", false],
        ["BIOL 1720 and BIOL 1760", "Fills 1 of 2 selections", false],
        ["BIOL 1710, BIOL 1720 and BIOL 1760", "Fills both selections", true],
      ]);
      expect(listed.find((option) => option.courses === "BIOL 1112")?.fills).toBe("Fills 1 of 2 selections");
      expect(listed.filter((option) => option.finishes)).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  test("after BIOL 1710 and its lab: 1 selection, and each option fills the last one", async () => {
    const { view, options } = await labScience([row("BIOL 1710", "Fall 2025", "B", 3), row("BIOL 1760", "Fall 2025", "A", 1)]);
    try {
      expect(text(view.container.querySelector(".detailStatus"))).toBe("Still needs 1 selection");
      expect(text(view.container.querySelector(".reqLead"))).toBe("1 more selection from these:");
      const listed = options();
      expect(listed.find((option) => option.courses === "BIOL 1720")?.fills).toBe("Fills the last selection");
      expect(listed.every((option) => option.fills === "Fills the last selection" && option.finishes)).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});

describe("selections or courses", () => {
  const slot = (courses: string[], picks = 1) => ({ options: [{ courses, picks }] });

  test("one course filling one pick is counted in courses; a set or a double pick in selections", () => {
    expect(countsSelections({ kind: "choose", picks: 2, eligible: [slot(["CSCE 4110"]), slot(["CSCE 4120"])] })).toBe(false);
    expect(countsSelections({ kind: "choose", picks: 2, eligible: [slot(["CSCE 4110"]), slot(["CHEM 1410", "CHEM 1430"])] })).toBe(true);
    expect(countsSelections({ kind: "choose", picks: 2, eligible: [slot(["CSCE 4110"], 2)] })).toBe(true);
  });

  test("what an option fills, in words", () => {
    expect(fillsText(1, 2)).toBe("Fills 1 of 2 selections");
    expect(fillsText(2, 2)).toBe("Fills both selections");
    expect(fillsText(1, 1)).toBe("Fills the last selection");
    expect(fillsText(2, 3)).toBe("Fills 2 of 3 selections");
    expect(fillsText(3, 3)).toBe("Fills all 3 selections");
  });
});
