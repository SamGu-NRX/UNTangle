import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { diffReleases, sanityCheck } from "../../src/release-job/compare";
import { buildSectionRelease, type SectionRelease } from "../../src/section-release";

/**
 * vsb-spring-2027.json is the checked-in acceptance fixture: a real
 * vsb.untgrades.app schema v2 term file cut to seven courses (source URL and
 * date recorded beside it in section-release.test.ts). Read as text, so its
 * exact bytes are a body.
 */
const body = readFileSync(path.join(import.meta.dir, "..", "fixtures", "vsb-spring-2027.json"), "utf8");
const input = { sourceId: "vsb-untgrades", institutionId: "unt", termId: "spring-2027", fetchedAt: "2026-10-14T18:00:00.000Z" };

type Raw = {
  coverage: Record<string, number>;
  courses: Record<string, { status: string; sections: Array<Record<string, unknown> & { linked_sections: Array<Record<string, unknown>>; meetings: Array<Record<string, unknown>> }> }>;
};

function release(edit: (raw: Raw) => void = () => {}): SectionRelease {
  const raw = JSON.parse(body) as Raw;
  edit(raw);
  const result = buildSectionRelease({ ...input, body: JSON.stringify(raw) });
  if (!result.ok) throw new Error(`expected a release, got ${result.reason}: ${result.message}`);
  return result.release;
}

describe("diffReleases", () => {
  test("identical releases give an empty diff", () => {
    const diff = diffReleases(release(), release());
    expect(diff.coursesAdded).toEqual([]);
    expect(diff.coursesRemoved).toEqual([]);
    expect(diff.sectionsAdded).toEqual([]);
    expect(diff.sectionsRemoved).toEqual([]);
    expect(diff.changes).toEqual([]);
    expect(diff.summary).toBe("");
  });

  test("an edited seat count, instructor, status and room show as changes", () => {
    const before = release();
    const after = release(raw => {
      const section = raw.courses["MATH 1680"].sections[0];
      // Seats and instructor live on the linked enrollment rows; room on the section's meeting rows.
      section.linked_sections[0].open_seats = 3;
      section.linked_sections[0].instructor = "Someone,Else";
      section.meetings[0].room = "Hickory 101";
      section.status = "Closed";
    });
    const diff = diffReleases(before, after);
    const seats = diff.changes.find(change => change.kind === "seats");
    expect(seats).toMatchObject({ courseCode: "MATH 1680", before: "99 of 99 open", after: "3 of 99 open" });
    expect(diff.changes.some(change => change.kind === "instructor" && change.after === "Someone,Else")).toBe(true);
    // A room edit moves the meeting line, so it surfaces under "time".
    expect(diff.changes.some(change => change.kind === "time" && change.after.includes("Hickory 101"))).toBe(true);
    expect(diff.changes.some(change => change.kind === "status" && change.before === "open" && change.after === "closed")).toBe(true);
    expect(diff.summary).toContain("changes to existing sections");
  });

  test("an added and a removed course show as added and removed", () => {
    const before = release();
    const after = release(raw => {
      raw.courses["CSCI 9999"] = JSON.parse(JSON.stringify(raw.courses["MATH 1680"])) as Raw["courses"][string];
      delete raw.courses["AARS 6810"];
      // CSCI replaces a course with no options, so courses stay 7 but the
      // with-options claim moves from 6 to 7.
      raw.coverage.courses_with_options = 7;
    });
    const diff = diffReleases(before, after);
    expect(diff.coursesAdded).toEqual(["CSCI 9999"]);
    expect(diff.coursesRemoved).toEqual(["AARS 6810"]);
    // The added course carries one enrollment option, the removed one had none.
    expect(diff.summary).toBe("1 course added, 1 course removed, 1 section added");
  });

  test("a changed meeting time shows as a time change", () => {
    const before = release();
    const after = release(raw => {
      // The release's meeting facts come from the section's own meetings rows,
      // not its linked enrollment rows.
      raw.courses["MATH 1680"].sections[0].meetings[0].start_time = "10:00AM";
    });
    const diff = diffReleases(before, after);
    // The release stores day codes and minute-of-day, so the after text starts "Tue 600".
    expect(diff.changes.some(change => change.kind === "time" && change.after.startsWith("Tue 600"))).toBe(true);
  });
});

describe("sanityCheck", () => {
  test("a first release with sections and no parser failures passes", () => {
    expect(sanityCheck(null, release())).toEqual({ ok: true });
  });

  test("an unchanged release passes", () => {
    const one = release();
    expect(sanityCheck(one, one)).toEqual({ ok: true });
  });

  test("a course count drop over 20% is refused", () => {
    const before = release();
    const after = release(raw => {
      // Drop three of seven courses and fix the coverage claim, so the build
      // succeeds and only the sanity check can refuse it. Six of the seven
      // fixture courses carry sections; the three dropped all do.
      for (const code of ["ACCT 5120", "BCIS 4740", "DBAS 6003"]) delete raw.courses[code];
      raw.coverage.catalog_courses = 4;
      raw.coverage.completed_courses = 4;
      raw.coverage.courses_with_options = 3;
    });
    const result = sanityCheck(before, after);
    expect(result).toMatchObject({ ok: false, check: "course-count-drop" });
    expect(result.ok === false && result.detail).toContain("42.9%");
  });

  test("a drop over 20% is refused, one at exactly 20% is not", () => {
    // sanityCheck reads the manifests, so the boundary is driven directly:
    // 7 courses after a run that counted 9 is a 22.2% drop, refused.
    const shrunken = release();
    shrunken.manifest.counts.courses = 7;
    const countedNine = release();
    countedNine.manifest.counts.courses = 9;
    expect(sanityCheck(countedNine, shrunken)).toMatchObject({ ok: false, check: "course-count-drop", detail: expect.stringContaining("22.2%") });
    // 7 after a run that counted 8 is a 12.5% drop, inside the limit.
    const countedEight = release();
    countedEight.manifest.counts.courses = 8;
    expect(sanityCheck(countedEight, shrunken)).toEqual({ ok: true });
    // 8 after 10 is exactly a fifth, which is a drop of 20%, not over it.
    const countedTen = release();
    countedTen.manifest.counts.courses = 10;
    const eight = release();
    eight.manifest.counts.courses = 8;
    expect(sanityCheck(countedTen, eight)).toEqual({ ok: true });
  });

  test("a parser failure that was not there before is refused", () => {
    const before = release();
    const after = release(raw => {
      // A course whose status the parser rejects becomes an invalid-data record.
      raw.courses["ACCT 5120"].status = "mysterious";
    });
    const result = sanityCheck(before, after);
    expect(result).toMatchObject({ ok: false, check: "parser-failure" });
  });

  // The explicit parser-failure rule in three cases: a same invalid count
  // publishes, a share over 5% refuses, a rising count refuses. The share
  // arithmetic needs room, so these fixtures grow the seven-course acceptance
  // fixture with clones of MATH 1680 (codes MATH 9000+, each carrying MATH's
  // sections; AARS 6810 is the only original without options). Invalid courses
  // are clones, so six original with-options courses survive every edit.
  function releaseWith(total: number, invalid: number): SectionRelease {
    return release(raw => {
      const original = raw.courses["MATH 1680"];
      const clones: string[] = [];
      for (let i = 0; i < total - 7; i++) {
        const code = `MATH 9${String(i).padStart(3, "0")}`;
        raw.courses[code] = JSON.parse(JSON.stringify(original)) as Raw["courses"][string];
        clones.push(code);
      }
      for (const code of clones.slice(0, invalid)) raw.courses[code].status = "mysterious";
      raw.coverage.catalog_courses = total;
      raw.coverage.completed_courses = total;
      // Invalid-data courses still count as courses and as with-options: the
      // only course without options in any of these fixtures is AARS 6810.
      raw.coverage.courses_with_options = total - 1;
    });
  }

  test("the same invalid count as the last good release publishes", () => {
    const before = releaseWith(25, 1);
    expect(before.manifest.counts.invalidCourses).toBe(1);
    const after = releaseWith(25, 1);
    expect(after.manifest.counts.invalidCourses).toBe(1);
    // One invalid course in twenty-five is 4%, inside the share limit, and the
    // count did not rise: the per-course invalid-data record may publish.
    expect(sanityCheck(before, after)).toEqual({ ok: true });
  });

  test("an invalid share over 5% is refused", () => {
    // Two of forty is exactly the 5% limit and passes; two of thirty-three is
    // 6.1%, over it. The course-count drop (17.5%) stays inside the 20%
    // course-count rule, so only the share rule can refuse this pair.
    const before = releaseWith(40, 2);
    expect(sanityCheck(before, before)).toEqual({ ok: true });
    const after = releaseWith(33, 2);
    const result = sanityCheck(before, after);
    expect(result).toMatchObject({ ok: false, check: "parser-failure" });
    expect(result.ok === false && result.detail).toContain("over the 5% limit");
  });

  test("a rising invalid count is refused even when the share stays inside the limit", () => {
    // One invalid of twenty-five is 4%; two of forty is exactly 5%, not over
    // it. Only the rising count (1 -> 2) can refuse this pair.
    const before = releaseWith(25, 1);
    const after = releaseWith(40, 2);
    expect(after.manifest.counts.invalidCourses).toBe(2);
    const result = sanityCheck(before, after);
    expect(result).toMatchObject({ ok: false, check: "parser-failure" });
    expect(result.ok === false && result.detail).toContain("a rising count is refused");
  });

  test("a release with no sections at all is refused", () => {
    const before = release();
    const after = release(raw => {
      for (const course of Object.values(raw.courses)) course.sections = [];
      raw.coverage.courses_with_options = 0;
    });
    expect(sanityCheck(before, after)).toMatchObject({ ok: false, check: "no-sections" });
  });

  test("an empty release is refused", () => {
    const before = release();
    // buildSectionRelease refuses an empty course map outright, so the empty
    // release is constructed directly to reach the sanity check.
    const after = release();
    after.courses = [];
    after.manifest.counts.courses = 0;
    expect(sanityCheck(before, after)).toMatchObject({ ok: false, check: "empty" });
  });
});
