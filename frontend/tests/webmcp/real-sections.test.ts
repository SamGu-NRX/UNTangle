/**
 * The tools on real Spring 2027 options (the committed vsb fixture, nothing
 * fetched): build_schedule suggests only what the Week view's filters allow,
 * and apply_alternative keeps the Week view's merged-plan guard.
 */
import { describe, expect, test } from "bun:test";
import { optionLabel, otherSiteOf, type SectionCatalog } from "@/lib/planner-sections";
import { createTools, type Tool } from "@/lib/webmcp/tools";
import { courseAs, fixtureCatalog, fixtureInput, optionsOf, renumber, setDates } from "../sections/real-term";
import { fixturePlan, fixturePort, session } from "./fixture";

const named = (tools: Tool[], name: string) => tools.find((tool) => tool.name === name)!;
/** A plan holding only `codes` for the planning term. */
const planOf = (...codes: string[]) =>
  fixturePlan({}, { "CSCE 1040": "notTaken", "ENGL 1310": "notTaken", "PSYC 1630": "notTaken", ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) });
type Alternative = { id: string; sections: Record<string, string> };

/** SPAN 2040 as MATH 1680's real option "110 + 111", with `edit` applied to the row and each of its meeting lines. */
function spanCourse(edit: (line: { room: string; status?: string }) => void) {
  const input = fixtureInput();
  courseAs(input, "MATH 1680", "SPAN 2040", (row) => [row, ...row.linked_sections, ...row.meetings].forEach(edit));
  const catalog = fixtureCatalog(input);
  return { catalog, option: optionsOf(catalog, "SPAN 2040")[0] };
}

/** The SPAN 2040 sections build_schedule suggests under these filters; none when it has nothing to suggest. */
async function suggested(catalog: SectionCatalog, filters: { openSeatsOnly?: boolean; otherSites?: boolean }) {
  const { port, student } = fixturePort(planOf("SPAN 2040"), {}, catalog);
  student.setPreferences((p) => ({ ...p, constraints: { ...p.constraints, ...filters } }));
  const result = await named(createTools(), "build_schedule").run({}, session(port, true).ctx);
  if (!result.ok && result.reason === "nothing_to_schedule") return new Set<string>();
  if (!result.ok) throw new Error(`build_schedule failed: ${result.reason}`);
  return new Set((result.alternatives as Alternative[]).map((alt) => alt.sections["SPAN 2040"]));
}

describe("build_schedule follows the Week view's filters", () => {
  test("a section outside Denton is suggested only when the student allows other sites", async () => {
    const { catalog, option } = spanCourse((line) => (line.room = "FRLD 458"));
    expect(otherSiteOf(option)).toBe("Frisco");
    expect(await suggested(catalog, {})).not.toContain(optionLabel(option));
    expect(await suggested(catalog, { otherSites: true })).toContain(optionLabel(option));
  });

  test("a full section is suggested by default and not under Open seats only", async () => {
    const { catalog, option } = spanCourse((line) => {
      if ("status" in line) line.status = "Closed";
    });
    expect(option.status).toBe("closed");
    expect(await suggested(catalog, {})).toContain(optionLabel(option));
    expect(await suggested(catalog, { openSeatsOnly: true })).not.toContain(optionLabel(option));
  });
});

test("apply_alternative refuses an option whose merged plan would overlap, as the Week view does", async () => {
  // MATH 1680 and SPAN 2050 (two weekly options). The search's key holds option ids, not times,
  // so an update that moves an option's meetings keeps the key: only the merged-plan check sees the overlap.
  const input = fixtureInput();
  const option = (number: string, days: string, start: string, end: string) => {
    const row = structuredClone(input.courses["ACCT 5120"].sections[0]);
    renumber(row, [number]);
    setDates(row, "01/11/2027 - 05/07/2027");
    row.session = "Regular Academic Session";
    [...row.linked_sections, ...row.meetings].forEach((line) => Object.assign(line, { room: "Gab 511", days, start_time: start, end_time: end }));
    return row;
  };
  const withSpan = (days: string, start: string, end: string) => {
    const copy = structuredClone(input);
    (copy.courses as Record<string, unknown>)["SPAN 2050"] = {
      ...structuredClone(input.courses["ACCT 5120"]),
      course_code: "SPAN 2050",
      sections: [option("7100", days, start, end), option("7200", days, start, end)],
    };
    return fixtureCatalog(copy);
  };
  let current = withSpan("S", "8:00AM", "8:50AM");
  const catalog: SectionCatalog = (code) => current(code);
  const { port } = fixturePort(planOf("MATH 1680", "SPAN 2050"), {}, catalog);
  const tools = createTools();
  const built = await named(tools, "build_schedule").run({}, session(port, true).ctx);
  if (!built.ok) throw new Error(`build_schedule failed: ${built.reason}`);
  const [first] = built.alternatives as Alternative[];
  // SPAN 2050's options now meet all week, all day: over whichever MATH 1680 section the option holds.
  current = withSpan("MTWRF", "8:00AM", "9:50PM");
  const { ctx, asked } = session(port, true);
  const result = await named(tools, "apply_alternative").run({ id: first.id }, ctx);
  expect(result).toMatchObject({ ok: false, reason: "cannot_apply" });
  expect((result as { detail?: string }).detail).toMatch(/would make (MATH 1680 and SPAN 2050|SPAN 2050 and MATH 1680) overlap/);
  expect(asked).toEqual([]);
});
