/**
 * Week's Details table for an alternative: what it marks better or worse
 * when one week has no timed class, or a walk with no known time.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Section } from "@/lib/sections";
import { installDom, mount, removeDom } from "../ui/dom";
import { asyncMeeting, meeting, section } from "./fixtures";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const mwf = (code: string, at: string, until: string, building: string) =>
  section({ courseCode: code, meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at, until, building })) });
// GAB to CURY is 5 minutes; nothing is known about the way to the annex.
const walk = (a: string, b: string) => ((a === "gab" && b === "cury") || (a === "cury" && b === "gab") ? { seconds: 300, shuttle: false } : null);

async function details(now: Section[], option: Section[]) {
  const { OptionDetails } = await import("@/components/schedule-builder/panels");
  const { eventsOf, unknownWalksOf, walksOf } = await import("@/components/schedule-builder/week");
  const week = (sections: Section[]) => {
    const events = eventsOf(sections);
    return { events, walks: walksOf(events, walk), unknownWalks: unknownWalksOf(events, walk), sections };
  };
  const view = await mount(
    <OptionDetails now={week(now)} option={week(option)} label="Option 1" lean={null} reasons={[]} onUse={() => {}} canUse />,
  );
  const row = (name: string) => {
    const tr = [...document.querySelectorAll("tr")].find((r) => r.querySelector("th")?.textContent === name)!;
    const cells = [...tr.querySelectorAll("td")];
    return { now: cells[0].textContent, option: cells[1].textContent, change: cells[1].getAttribute("data-change") };
  };
  return { view, row };
}

describe("Details beside the week", () => {
  test("an option with no timed class has no first or last class to call better or worse", async () => {
    const online = section({ courseCode: "CSCE 2110", sectionCode: "900", online: true, meetings: [asyncMeeting] });
    const { view, row } = await details([mwf("CSCE 2110", "9:00", "9:50", "gab")], [online]);
    expect(row("First class")).toEqual({ now: "9:00", option: "None", change: null });
    expect(row("Last class ends")).toEqual({ now: "9:50", option: "None", change: null });
    await view.unmount();
  });

  test("a walk with no known time makes the option's walking at least its known part, judged neither way", async () => {
    const now = [mwf("CSCE 2110", "9:00", "9:50", "gab"), mwf("MATH 2700", "10:00", "10:50", "cury")];
    const option = [mwf("CSCE 2110", "9:00", "9:50", "gab"), mwf("MATH 2700", "10:00", "10:50", "annex")];
    const { view, row } = await details(now, option);
    // Now walks GAB to CURY three times a week; the option's only walk has no known time.
    expect(row("Walking a week")).toEqual({ now: "15 min", option: "At least 0 min", change: null });
    expect(row("Tight or late walks")).toEqual({ now: "0", option: "At least 0", change: null });
    await view.unmount();
  });
});
