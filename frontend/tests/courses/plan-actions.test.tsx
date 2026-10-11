/**
 * Mounted regression tests for the course detail planner actions.
 *
 * The hardening work (PR #7 review) found that the detail page wrote planner
 * choices regardless of hydration and ignored the catalog rows' prerequisite
 * lock. These tests mount the real `CoursePlanActions` component and pin:
 *
 * 1. Delayed bootstrap: while the planner is still hydrating, status and
 *    section controls are disabled and no write reaches the provider.
 * 2. Prerequisite lock: the rows' lock policy (`locked && !completed` blocks
 *    status changes and section adds) is enforced here too, and released
 *    once the course is Done.
 * 3. Section choices are distinguishable to assistive tech: bundled sample
 *    sections of one course can share a title AND professor (real data:
 *    Bahar Dorri teaches both csce-2100-001 and -002), so the section number
 *    is part of every radio's accessible name.
 *
 * The planner provider is replaced with a recording stub via bun's
 * mock.module — the real provider pulls the auth session client, which these
 * offline tests must never touch. All courses/sections are real seed data.
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import "./setup-dom";

// --- recording stub for the planner provider ---
const toasts: string[] = [];
const statusWrites: Array<{ code: string; status: string }> = [];
const sectionWrites: Array<{ code: string; sectionId: string }> = [];

let hydrated = false;
let lockedFor: (code: string) => boolean = () => false;
let plannerState: {
  courseStatuses: Record<string, string>;
  selectedSections: Record<string, string>;
  transcriptRecords: unknown[];
} = { courseStatuses: {}, selectedSections: {}, transcriptRecords: [] };

mock.module("@/components/planner-provider", () => ({
  usePlanner: () => ({
    hydrated,
    plannerState,
    setCourseStatus: (code: string, status: string) => {
      statusWrites.push({ code, status });
    },
    setSection: (code: string, sectionId: string) => {
      sectionWrites.push({ code, sectionId });
    },
    isLocked: lockedFor,
  }),
  useToast: () => ({
    toast: (message: string) => {
      toasts.push(message);
    },
  }),
}));

const { render, fireEvent, cleanup, within } = await import("@testing-library/react");
const { CoursePlanActions } = await import("@/components/course-plan-actions");

beforeEach(() => {
  toasts.length = 0;
  statusWrites.length = 0;
  sectionWrites.length = 0;
  hydrated = false;
  lockedFor = () => false;
  plannerState = { courseStatuses: {}, selectedSections: {}, transcriptRecords: [] };
});

afterEach(() => {
  cleanup();
});

function mountActions() {
  const { container } = render(<CoursePlanActions courseCode="CSCE 2100" />);
  return { container, q: within(container) };
}

describe("delayed bootstrap (witness)", () => {
  test("planner writes stay impossible until hydration finishes", () => {
    const { q } = mountActions();

    const taking = q.getByRole("button", { name: "Taking" }) as HTMLButtonElement;
    const notTaken = q.getByRole("button", { name: "Not taken" }) as HTMLButtonElement;
    expect(taking.disabled).toBe(true);
    expect(notTaken.disabled).toBe(true);
    for (const radio of q.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }

    fireEvent.click(taking);
    fireEvent.click(notTaken);
    expect(statusWrites).toEqual([]);
    expect(q.getByRole("status").textContent).toContain("Loading your plan");
  });

  test("choices unlock once hydration finishes and reach the planner", () => {
    hydrated = true;
    const { q } = mountActions();

    const notTaken = q.getByRole("button", { name: "Not taken" }) as HTMLButtonElement;
    const taking = q.getByRole("button", { name: "Taking" }) as HTMLButtonElement;
    expect(notTaken.getAttribute("aria-pressed")).toBe("true");
    expect(taking.disabled).toBe(false);

    fireEvent.click(taking);
    expect(statusWrites).toEqual([{ code: "CSCE 2100", status: "inProgress" }]);
  });
});

describe("prerequisite lock respected (witness)", () => {
  test("a locked, not-yet-done course cannot be marked Taking/Done or add a section", () => {
    hydrated = true;
    lockedFor = (code) => code === "CSCE 2100";
    const { q } = mountActions();

    expect((q.getByRole("button", { name: "Taking" }) as HTMLButtonElement).disabled).toBe(true);
    expect((q.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    expect((q.getByRole("button", { name: "Not taken" }) as HTMLButtonElement).disabled).toBe(false);

    const lock = q.getByText(/Requires:/);
    expect(lock.textContent).toContain("CSCE 1040");

    fireEvent.click(q.getByRole("radio", { name: /Section 001/ }));
    const add = q.getByRole("button", { name: "Add CSCE 2100 section 001" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(sectionWrites).toEqual([]);
  });

  test("marking the course Done releases the lock (same policy as catalog rows)", () => {
    hydrated = true;
    lockedFor = () => true;
    plannerState = {
      courseStatuses: { "CSCE 2100": "completed" },
      selectedSections: {},
      transcriptRecords: [],
    };
    const { q } = mountActions();

    expect((q.getByRole("button", { name: "Taking" }) as HTMLButtonElement).disabled).toBe(false);
    expect((q.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("section choices are distinguishable (witness)", () => {
  test("radios expose section numbers, so same-professor sections read differently", () => {
    hydrated = true;
    const { q } = mountActions();

    const radios = q.getAllByRole("radio");
    expect(radios.length).toBe(13); // 12 bundled sample sections + "No section yet"

    const one = q.getByRole("radio", { name: /Section 001/ });
    const two = q.getByRole("radio", { name: /Section 002/ });
    expect(one).not.toBe(two);
    expect(q.getByRole("radio", { name: "No section yet" })).toBeTruthy();
  });

  test("choosing a section then Add persists exactly that section", () => {
    hydrated = true;
    const { q } = mountActions();

    fireEvent.click(q.getByRole("radio", { name: /Section 001/ }));
    const add = q.getByRole("button", { name: "Add CSCE 2100 section 001" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(sectionWrites).toEqual([{ code: "CSCE 2100", sectionId: "csce-2100-001" }]);
    expect(toasts.some((t) => t.includes("section 001"))).toBe(true);
  });
});
