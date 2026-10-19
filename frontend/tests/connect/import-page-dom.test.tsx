import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { click, installDom, mount, removeDom } from "../ui/dom";

installDom();
const { act } = await import("react");
const realPlanner = { ...(await import("@/components/planner-provider")) };
const realAuth = { ...(await import("@/lib/auth-client")) };
const realParser = { ...(await import("@/lib/connect/import")) };
const realNavigation = { ...(await import("next/navigation")) };
const realAccount = { ...(await import("@/components/shell/AccountMenu")) };
const realPersistence = { ...(await import("@/components/planner-persistence-panel")) };
const cssPath = "@/components/connect/connect.module.css";
mock.module(cssPath, () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

let session: { data: { user: { id: string } } | null; isPending: boolean };
const applyTranscriptRecords = mock(() => {});
const router = { push: mock(() => {}) };
let parse: typeof realParser.parseConnectTranscript;
mock.module("@/components/planner-provider", () => ({
  ...realPlanner,
  usePlanner: () => ({
    applyTranscriptRecords,
    hydrated: true,
    conflict: null,
    saveState: { status: "saved" },
    plannerState: { transcriptRecords: [] },
  }),
}));
mock.module("@/lib/auth-client", () => ({ ...realAuth, authClient: { ...realAuth.authClient, useSession: () => session } }));
mock.module("@/lib/connect/import", () => ({ ...realParser, parseConnectTranscript: (...args: Parameters<typeof parse>) => parse(...args) }));
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => router }));
mock.module("@/components/shell/AccountMenu", () => ({ ...realAccount, AccountMenu: () => null }));
mock.module("@/components/planner-persistence-panel", () => ({ ...realPersistence, PlannerPersistencePanel: () => null }));

const { ImportPage } = await import("@/components/connect/import-page");
const { MYUNT_URL } = await import("@/components/connect/myunt-trip");
const { readTripFlag } = await import("@/components/connect/trip-flag");
let page: Awaited<ReturnType<typeof mount>> | undefined;

beforeEach(() => {
  session = { data: { user: { id: "student" } }, isPending: false };
  parse = realParser.parseConnectTranscript;
  applyTranscriptRecords.mockClear();
  router.push.mockClear();
  window.sessionStorage.clear();
});
afterEach(async () => {
  await page?.unmount();
  page = undefined;
  mock.restore();
  window.sessionStorage.clear();
});
afterAll(() => {
  mock.module("@/components/planner-provider", () => realPlanner);
  mock.module("@/lib/auth-client", () => realAuth);
  mock.module("@/lib/connect/import", () => realParser);
  mock.module("next/navigation", () => realNavigation);
  mock.module("@/components/shell/AccountMenu", () => realAccount);
  mock.module("@/components/planner-persistence-panel", () => realPersistence);
  removeDom();
});

function button(label: string): HTMLButtonElement {
  const found = [...page!.container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function choose(file: File) {
  const input = page!.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("while another PDF is read, the old review stays as it was and its Looks right saves nothing", async () => {
  const resultA = await realParser.parseConnectTranscript({ kind: "transcript-text", text: "2025 Fall\nCSCE 1030 Computer Science I 3.000 3.000 A 12.000" }, new AbortController().signal);
  const resultB = await realParser.parseConnectTranscript({ kind: "transcript-text", text: "2025 Fall\nENGL 1310 College Writing I 3.000 3.000 A 12.000" }, new AbortController().signal);
  const fileA = new File(["A"], "a.pdf", { type: "application/pdf" });
  const fileB = new File(["B"], "b.pdf", { type: "application/pdf" });
  const pendingB = Promise.withResolvers<typeof resultB>();
  parse = mock(async (file) => {
    if (file === fileA) return resultA;
    if (file === fileB) return pendingB.promise;
    throw new Error("Unexpected transcript file");
  });
  page = await mount(<ImportPage />);
  await choose(fileA);
  const save = button("Looks right");
  const wrapper = save.closest("section")!;
  const review = wrapper.innerHTML;
  expect(wrapper.textContent).toContain("CSCE 1030");

  await click(button("Use a different file"));
  await choose(fileB);
  expect(wrapper.innerHTML).toBe(review);
  expect(page.container.textContent).not.toContain("Reading your transcript");
  await click(save);
  expect(applyTranscriptRecords).not.toHaveBeenCalled();

  await act(async () => { pendingB.resolve(resultB); });
  const nextWrapper = button("Looks right").closest("section")!;
  expect(nextWrapper.textContent).toContain("ENGL 1310");
  expect(nextWrapper.textContent).not.toContain("CSCE 1030");
  expect(applyTranscriptRecords).not.toHaveBeenCalled();
  await click(button("Looks right"));
  expect(applyTranscriptRecords).toHaveBeenCalledWith(resultB.records);
});

test("Open myUNT is a disabled button until identity resolves, then the existing myUNT link", async () => {
  session = { data: null, isPending: true };
  spyOn(window, "open").mockReturnValue(null);
  page = await mount(<ImportPage />);
  const control = [...page.container.querySelectorAll("a, button")].find((node) => node.textContent?.startsWith("Open myUNT"))!;
  await click(control);
  expect(readTripFlag()).toBe(false);
  expect(control.tagName).toBe("BUTTON");
  expect((control as HTMLButtonElement).disabled).toBe(true);
  expect(control.getAttribute("type")).toBe("button");
  expect(control.className).toBe("ui-btn ui-btn--primary ui-btn--lg");
  expect(control.getAttribute("data-ui")).toBe("");

  session = { data: { user: { id: "student" } }, isPending: false };
  await page.rerender(<ImportPage />);
  const link = page.container.querySelector<HTMLAnchorElement>(`a[href="${MYUNT_URL}"]`)!;
  expect(link).not.toBeNull();
  expect(link.className).toBe(control.className);
  expect(link.innerHTML).toBe(control.innerHTML);
  expect(link.getAttribute("data-ui")).toBe("");
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
});
