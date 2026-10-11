/**
 * Mounted regression tests for the text import panel's read races.
 *
 * PR #7 review found that a slow file read finishing AFTER the user typed or
 * pasted into the textarea replaced their newer text with the file's content.
 * These tests mount the real `CourseImportPanel` and pin:
 *
 * 1. A file read that resolves after a user edit is discarded — the typed or
 *    pasted text survives, and the review never shows the file's content.
 * 2. An unimpeded file read still populates the review (the guard must not
 *    break the happy path).
 * 3. Applying imports waits for the planner: with `plannerReady` false the
 *    Apply button is disabled and no status write can happen.
 *
 * Queries are scoped to each render's container (not the global document) so
 * consecutive renders in one file stay independent. Logic stays with
 * `@/lib/course-import-state`'s ImportReadGuard, unit-tested directly. All
 * records are synthetic.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestFile } from "./setup-dom";

const { render, fireEvent, cleanup, act, within } = await import("@testing-library/react");
const { CourseImportPanel } = await import("@/components/course-import-panel");
const { ImportReadGuard } = await import("@/lib/course-import-state");

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

function mountPanel(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const toasts: string[] = [];
  const { container } = render(
    <CourseImportPanel
      courseStatuses={{}}
      setCourseStatus={(code: string, status: string) => writes.push(`${code}:${status}`)}
      toast={(message: string) => toasts.push(message)}
      {...overrides}
    />,
  );
  const q = within(container);
  return { writes, toasts, q, container };
}

describe("slow file read racing a paste (witness)", () => {
  test("a read that finishes after the user edits never replaces their text", async () => {
    const { writes, q, container } = mountPanel();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    let resolveRead: (text: string) => void = () => {};
    const file = new TestFile(["CSCE 3444"], "slow.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", {
      value: () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const reading = q.getByRole("button", { name: /Reading file/i }) as HTMLButtonElement;
    expect(reading.disabled).toBe(true);

    // The user types (or pastes) while the read is pending.
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "MATH 1650" } });
    });

    // The slow read resolves with its own content.
    await act(async () => {
      resolveRead("CSCE 3444");
    });

    expect(textarea.value).toBe("MATH 1650");
    expect(q.queryByText(/CSCE 3444/)).toBeNull();
    expect(q.getByRole("button", { name: "Review import" }).hasAttribute("disabled")).toBe(false);
    expect(writes).toEqual([]);
  });

  test("an unimpeded file read still populates the review", async () => {
    const { q, container } = mountPanel();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new TestFile(["CSCE 3444"], "clean.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });
    await act(async () => {});

    const matches = await q.findAllByText(/CSCE 3444/);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe("apply waits for the planner (witness)", () => {
  test("with plannerReady false, Apply is disabled and writes nothing", async () => {
    const { writes, q } = mountPanel({ plannerReady: false });

    const textarea = q.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "CSCE 3444" } });
    });
    await act(async () => {
      fireEvent.click(q.getByRole("button", { name: "Review import" }));
    });

    const apply = q.getByRole("button", { name: /Apply 1 change/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(q.getByRole("status").textContent).toContain("still loading");
    await act(async () => {
      fireEvent.click(apply);
    });
    expect(writes).toEqual([]);
  });
});

describe("ImportReadGuard invalidation semantics", () => {
  test("invalidate cancels only an in-flight read; settle ends the flight", () => {
    const Guard = ImportReadGuard as new () => {
      begin(): number;
      isStale(token: number): boolean;
      settle(): void;
      invalidate(): boolean;
    };
    const guard = new Guard();

    const first = guard.begin();
    expect(guard.isStale(first)).toBe(false);
    expect(guard.invalidate()).toBe(true);
    expect(guard.isStale(first)).toBe(true);
    expect(guard.invalidate()).toBe(false);

    const second = guard.begin();
    guard.settle();
    expect(guard.isStale(second)).toBe(false);
    expect(guard.invalidate()).toBe(false);
  });
});
