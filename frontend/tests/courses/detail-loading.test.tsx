import { expect, mock, test } from "bun:test";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

// Found while fixing #126: the detail opened from a deep link before the saved
// plan had loaded showed the course as unplanned, with a live Add button.
test("before the saved plan loads, the course detail shows loading and no status, actions or sections", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { CourseDetail } = await import("@/components/courses/CourseDetail");
  const { untProfile } = await import("@/components/courses/school");
  const { buildCourseModel } = await import("@/components/courses/model/course-model");
  const profile = untProfile();
  const model = buildCourseModel(profile, {
    statuses: {},
    transcript: [],
    planned: new Set(),
    manualCredit: new Set(),
    autoPlanned: new Set(),
  });
  // A course with no prerequisites: the one whose stale "Add" the bug showed.
  const row = [...model.rows.values()].find((candidate) => candidate.status === "available")!;
  const noop = () => {};
  const render = (planLoaded: boolean) =>
    renderToStaticMarkup(
      React.createElement(CourseDetail, {
        row,
        model,
        profile,
        options: { status: "loading" },
        placed: [],
        chosenSectionId: undefined,
        initialInstructor: null,
        degreeNote: "On your major's core list.",
        actions: { plan: noop, unplan: noop, markCredit: noop, clearCredit: noop, chooseSection: noop },
        planLoaded,
      }),
    );

  const loading = render(false);
  expect(loading).toContain("Loading your courses");
  expect(loading).toContain(row.title);
  expect(loading).not.toContain("Add to");
  expect(loading).not.toContain("You can take this");
  expect(loading).not.toContain("I have credit for this");
  // Nothing renders below the title until the plan is read, so nothing moves when it arrives.
  expect(loading).not.toContain("Grades");

  const loaded = render(true);
  expect(loaded).not.toContain("Loading your courses");
  expect(loaded).toContain("You can take this");
  expect(loaded).toContain(`Add to ${profile.planningTerm}`);
});
