import { describe, expect, mock, test } from "bun:test";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

/**
 * The roadmap group's states, rendered as markup: closed, ready, waiting
 * on a replan, empty and failed. The motion and focus paths run in a real
 * browser (the PR lists that run); this pins what each state says.
 */
async function render(overrides: Record<string, unknown>) {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Roadmap } = await import("@/components/courses/Roadmap");
  const noop = () => {};
  return renderToStaticMarkup(
    React.createElement(Roadmap, {
      state: { kind: "closed" },
      open: true,
      onToggle: noop,
      limit: 15,
      onLimitChange: noop,
      stale: false,
      titleOf: (code: string) => (code === "GONE 1000" ? null : `Title of ${code}`),
      canOpen: (code: string) => code !== "GONE 1000",
      canOpenRequirement: () => false,
      onOpen: noop,
      onOpenRequirement: noop,
      selectedId: null,
      ...overrides,
    } as never),
  );
}

async function sampleRoadmap(extra: Record<string, unknown> = {}) {
  const { planRoadmap } = await import("@untangle/core/degree/roadmap");
  const citation = { page: "p.html", url: "https://example.test", anchor: null, heading: "Major" };
  const items = ["A 1000", "B 2000", "GONE 1000"].map((code) => ({ alternatives: [{ must: [code] }] }));
  return planRoadmap({
    programs: [{ id: "major", name: "Major", catalogId: "t", sourceUrl: citation.url, coreSharedCourses: [], courseSharing: "forbidden", requirements: [{ kind: "all", name: "Major", citation, items }, { kind: "pool", name: "Electives, 6 hours", citation, hours: 6, match: { subjects: ["X"], minLevel: 3000, maxLevel: 4999 } }] }],
    record: [],
    catalog: new Map([
      ["A 1000", { code: "A 1000", credits: 3, requires: { kind: "and", children: [] } }],
      ["B 2000", { code: "B 2000", credits: 3, requires: { kind: "course", code: "A 1000" } }],
    ]),
    start: { season: "spring", year: 2027 },
    creditLimit: 15,
    ...extra,
  });
}

describe("the roadmap group", () => {
  test("closed, it is one heading button and says what opening shows", async () => {
    const html = await render({ open: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Every term to the end of your degree");
    expect(html).not.toContain("Credits a term");
  });

  test("ready, it shows each term with its credits, the limit control, and what isn't in a term", async () => {
    const html = await render({ state: { kind: "ready", roadmap: await sampleRoadmap() } });
    expect(html).toContain("At 15 credits a term: 2 terms so far, and 1 course and 1 requirement not in a term yet.");
    expect(html).toContain('role="radiogroup" aria-label="Credits a term"');
    expect(html).toContain("Spring 2027");
    expect(html).toContain("Fall 2027");
    expect(html).toContain("3 credits");
    expect(html).toContain('data-row-open="B 2000"');
    expect(html).toContain("Not in a term yet");
    expect(html).toContain("Not in UNTangle&#x27;s catalog");
    // A course with no catalog data has no detail, so it is text, not a button.
    expect(html).not.toContain('data-row-open="GONE 1000"');
    expect(html).toContain("Electives");
    expect(html).toContain("6 credits to choose");
    expect(html).not.toContain("Replanning");
  });

  test("with full terms counted, each term shows the electives that fill it", async () => {
    const html = await render({ state: { kind: "ready", roadmap: await sampleRoadmap({ fullTermsForStanding: true }) } });
    expect(html).toContain("Electives you choose");
    expect(html).toContain("12 credits");
    const plain = await render({ state: { kind: "ready", roadmap: await sampleRoadmap() } });
    expect(plain).not.toContain("Electives you choose");
  });

  test("waiting on a replan, it says so (shown after 400ms by CSS) and marks the terms busy", async () => {
    const html = await render({ state: { kind: "ready", roadmap: await sampleRoadmap() }, stale: true, limit: 12 });
    expect(html).toContain("Replanning at 12 credits");
    expect(html).toContain('aria-busy="true"');
  });

  test("with nothing left it says so, and with an error it says what failed and where to look", async () => {
    const empty = await render({ state: { kind: "ready", roadmap: { start: { season: "spring", year: 2027 }, creditLimit: 15, terms: [], unplaced: [], open: [], left: [] } } });
    expect(empty).toContain("Nothing left to place. Every course your degree lists is done or underway.");
    const failed = await render({ state: { kind: "error", message: "The audit named no branch." } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("The audit named no branch.");
    expect(failed).toContain("still lists every requirement");
  });
});
