import { describe, expect, test } from "bun:test";
import { SheetHistory, type HistoryPort } from "@/components/ui/back-close";

/**
 * A browser history: entries with the page they show and an optional sheet
 * marker. Like the real one, back() is asynchronous: the step and its
 * popstate happen on flush().
 */
function fakeHistory(start: string[]) {
  const entries = start.map((href) => ({ href, marker: undefined as string | undefined }));
  let index = entries.length - 1;
  let pendingBacks = 0;
  const port: HistoryPort = {
    marker: () => entries[index].marker,
    href: () => entries[index].href,
    push: (marker) => {
      entries.splice(index + 1, entries.length, { href: entries[index].href, marker });
      index += 1;
    },
    replace: (marker) => {
      entries[index] = { ...entries[index], marker };
    },
    back: () => {
      pendingBacks += 1;
    },
  };
  const sheets = new SheetHistory(port);
  const flush = () => {
    while (pendingBacks > 0) {
      pendingBacks -= 1;
      index -= 1;
      sheets.popped();
    }
  };
  return {
    sheets,
    /** The user presses Back. */
    back: () => {
      port.back();
      flush();
    },
    /** The app pushes a new page, as router.push does. */
    navigate: (href: string) => {
      entries.splice(index + 1, entries.length, { href, marker: undefined });
      index += 1;
      sheets.navigated();
    },
    flush,
    page: () => entries[index].href,
    length: () => entries.length,
  };
}

describe("Back and sheets", () => {
  test("Back closes an open sheet and stays on the page", () => {
    const h = fakeHistory(["/schedule", "/courses"]);
    let closed = 0;
    h.sheets.opened(() => (closed += 1));
    h.back();
    expect({ closed, page: h.page() }).toEqual({ closed: 1, page: "/courses" });
    h.back();
    expect(h.page()).toBe("/schedule");
  });

  test("a sheet that closes itself gives its entry back, so the next Back leaves the page", () => {
    const h = fakeHistory(["/schedule", "/courses"]);
    let closed = 0;
    const id = h.sheets.opened(() => (closed += 1));
    h.sheets.dismissed(id);
    h.flush();
    expect({ closed, page: h.page() }).toEqual({ closed: 0, page: "/courses" });
    h.back();
    expect(h.page()).toBe("/schedule");
  });

  test("a sheet the page closed costs no extra Back press", () => {
    const h = fakeHistory(["/schedule", "/courses"]);
    const id = h.sheets.opened(() => {});
    h.sheets.abandoned(id);
    h.back();
    expect(h.page()).toBe("/schedule");
  });

  test("a link out of a sheet: Back returns to the page, the next Back leaves it", () => {
    const h = fakeHistory(["/schedule", "/courses"]);
    const id = h.sheets.opened(() => {});
    h.sheets.abandoned(id);
    h.navigate("/schedules");
    h.back();
    expect(h.page()).toBe("/courses");
    h.back();
    expect(h.page()).toBe("/schedule");
  });

  test("two sheets left behind on two pages: every Back shows a different page", () => {
    const h = fakeHistory(["/day", "/courses"]);
    h.sheets.abandoned(h.sheets.opened(() => {}));
    h.navigate("/schedules");
    h.sheets.abandoned(h.sheets.opened(() => {}));
    h.navigate("/auth");
    const pages = [h.page()];
    for (let i = 0; i < 3; i += 1) {
      h.back();
      pages.push(h.page());
    }
    expect(pages).toEqual(["/auth", "/schedules", "/courses", "/day"]);
  });

  test("reopening on a stale entry reuses it instead of stacking another", () => {
    const h = fakeHistory(["/schedule", "/courses"]);
    h.sheets.abandoned(h.sheets.opened(() => {}));
    const before = h.length();
    let closed = 0;
    h.sheets.opened(() => (closed += 1));
    expect(h.length()).toBe(before);
    h.back();
    expect({ closed, page: h.page() }).toEqual({ closed: 1, page: "/courses" });
  });
});
