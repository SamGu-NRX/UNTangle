import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { click, installDom, mount, removeDom } from "../ui/dom";
import type { ReactNode } from "react";

const originalFetch = globalThis.fetch;
let view: Awaited<ReturnType<typeof mount>> | null = null;
const requests: { path: string; init?: RequestInit }[] = [];
let session: { user: { id: string; email: string } } | null = { user: { id: "student-1", email: "student@my.unt.edu" } };
let failApproval = false;
let inspectStatus = 200;
let retryAfter: string | null = null;
let details = {
  clientKind: "extension",
  scopes: ["schedule:read", "schedule:add-option"],
  userCode: "ABCDEFGH",
  scheduleId: "schedule-123",
};

beforeAll(() => installDom());
afterEach(async () => {
  await view?.unmount();
  view = null;
  globalThis.fetch = originalFetch;
  requests.length = 0;
  session = { user: { id: "student-1", email: "student@my.unt.edu" } };
  failApproval = false;
  inspectStatus = 200;
  retryAfter = null;
  details = { clientKind: "extension", scopes: ["schedule:read", "schedule:add-option"], userCode: "ABCDEFGH", scheduleId: "schedule-123" };
});
afterAll(removeDom);

async function setup() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    requests.push({ path, init });
    if (path === "/api/auth/get-session") return Response.json(session);
    if (path === "/api/v1/device/inspect") return Response.json(details, { status: inspectStatus, headers: retryAfter ? { "Retry-After": retryAfter } : {} });
    if (path === "/api/v1/device/approve") {
      if (failApproval) return Response.json({ error: "unauthorized" }, { status: 401 });
      const { decision, expectedUserId } = JSON.parse(String(init?.body));
      if (expectedUserId !== session?.user.id) return Response.json({ error: "account_changed" }, { status: 409 });
      return Response.json({ status: decision === "approve" ? "approved" : "denied" });
    }
    if (path === "/api/auth/sign-in/email-otp") session = { user: { id: "student-2", email: "owner@my.unt.edu" } };
    return Response.json({ success: true });
  }) as typeof fetch;
  const { DeviceApproval } = await import("@/app/device/DeviceApproval");
  view = await mount(<DeviceApproval initialUserCode="ABCDEFGH" /> as ReactNode);
  return view.container;
}

function button(container: Element, text: string) {
  const found = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

async function input(container: Element, name: string, value: string) {
  const { act } = await import("react");
  const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent === name)!;
  const field = document.getElementById(label.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("shows client, account, what it may do with Main and matching code before explicit approval", async () => {
  details.scheduleId = "main";
  const container = await setup();
  expect(requests.some((request) => request.path.endsWith("/approve"))).toBe(false);
  await click(button(container, "Check device code"));
  expect(container.textContent).toContain("UNTangle browser extension");
  expect(container.textContent).toContain("See your Main schedule in UNTangle");
  expect(container.textContent).toContain("Add sections to Main after you confirm each one");
  // The grant's id is internal; the student approves access to Main, not an identifier.
  expect(container.textContent).not.toContain("Schedule identifier");
  expect(container.textContent).not.toMatch(/\bmain\b/);
  expect(container.textContent).toContain("student@my.unt.edu");
  expect(container.textContent).toContain("both codes match");
  expect(requests.some((request) => request.path.endsWith("/approve"))).toBe(false);
  await click(button(container, "Approve device"));
  expect(container.textContent).toContain("Device approved");
  expect(container.textContent).toContain("Go back to myUNT class search");
  expect(container.textContent).toContain("60 seconds");
  const approval = requests.find((request) => request.path.endsWith("/approve"))!;
  expect(JSON.parse(String(approval.init?.body))).toEqual({ userCode: "ABCDEFGH", decision: "approve", expectedUserId: "student-1" });
  for (const request of requests.filter((item) => item.init?.method === "POST")) {
    expect(request.init?.credentials).toBe("same-origin");
    expect(request.init?.headers).toEqual({ "Content-Type": "application/json", "X-UNTangle-Device": "1" });
  }
});

test("denial stays on the page and never sends approval", async () => {
  const container = await setup();
  await click(button(container, "Check device code"));
  await click(button(container, "Deny device"));
  expect(container.textContent).toContain("Device denied");
  expect(container.textContent).toContain("wasn't connected");
  expect(JSON.parse(String(requests.find((request) => request.path.endsWith("/approve"))?.init?.body)).decision).toBe("deny");
});

test("an expired browser session requires email sign-in without automatic approval", async () => {
  const container = await setup();
  await click(button(container, "Check device code"));
  failApproval = true;
  await click(button(container, "Approve device"));
  expect(container.textContent).toContain("Your sign-in expired");
  expect(container.textContent).toContain("Send sign-in code");
  expect(button(container, "Send sign-in code").disabled).toBe(false);
  expect(requests.filter((request) => request.path.endsWith("/approve"))).toHaveLength(1);
});

test("an account changed in another tab must be reviewed before a second explicit approval", async () => {
  const container = await setup();
  await click(button(container, "Check device code"));
  expect(container.textContent).toContain("Signed in as student@my.unt.edu");
  session = { user: { id: "student-2", email: "other@my.unt.edu" } };
  await click(button(container, "Approve device"));
  expect(container.textContent).toContain("Your signed-in account changed. Review the account before approving.");
  expect(container.textContent).toContain("Signed in as other@my.unt.edu");
  expect(container.textContent).not.toContain("Device approved");
  const approvals = () => requests.filter((request) => request.path.endsWith("/approve"));
  expect(approvals()).toHaveLength(1);
  expect(JSON.parse(String(approvals()[0].init?.body)).expectedUserId).toBe("student-1");
  await click(button(container, "Approve device"));
  expect(approvals()).toHaveLength(2);
  expect(JSON.parse(String(approvals()[1].init?.body)).expectedUserId).toBe("student-2");
  expect(container.textContent).toContain("Device approved");
});

test("invalid or expired device code gives a recovery action and no approve button", async () => {
  inspectStatus = 410;
  const container = await setup();
  await click(button(container, "Check device code"));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Start again in the app");
  expect(container.textContent).not.toContain("Approve device");
});

test("unexpected scopes never render an approval action", async () => {
  details.scopes.push("account:delete");
  const container = await setup();
  await click(button(container, "Check device code"));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Approve device");
});

test("mobile shows its document permissions, and rate limiting offers a retry", async () => {
  details = { clientKind: "mobile", scopes: ["documents:read", "documents:write"], userCode: "ABCDEFGH", scheduleId: "" };
  inspectStatus = 429;
  const container = await setup();
  await click(button(container, "Check device code"));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Too many attempts");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Wait before trying again.");
  expect(button(container, "Check device code").disabled).toBe(false);
  inspectStatus = 200;
  await click(button(container, "Check device code"));
  expect(container.textContent).toContain("UNTangle mobile app");
  expect(container.textContent).toContain("Read and change your saved plans and preferences");
  expect(container.textContent).not.toContain("Add sections to Main");
});

test("rate-limit copy uses the server Retry-After seconds", async () => {
  inspectStatus = 429;
  retryAfter = "600";
  const container = await setup();
  await click(button(container, "Check device code"));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Wait 600 seconds before trying again.");
});

test("email code sign-in, resend and change email do not approve the device", async () => {
  session = null;
  const container = await setup();
  await click(button(container, "Check device code"));
  await input(container, "UNT email", "owner@my.unt.edu");
  await click(button(container, "Send sign-in code"));
  expect(container.textContent).toContain("Check your inbox");
  await click(button(container, "Send a new code"));
  expect(requests.filter((request) => request.path.endsWith("send-verification-otp"))).toHaveLength(2);
  await click(button(container, "Change email"));
  await click(button(container, "Send sign-in code"));
  await input(container, "Email sign-in code", "123456");
  await click(button(container, "Sign in"));
  expect(container.textContent).toContain("owner@my.unt.edu");
  expect(container.textContent).toContain("Approve device");
  expect(requests.some((request) => request.path.endsWith("/approve"))).toBe(false);
  const signIn = requests.find((request) => request.path.endsWith("sign-in/email-otp"))!;
  expect(JSON.parse(String(signIn.init?.body))).toEqual({ email: "owner@my.unt.edu", otp: "123456" });
});

test("a personal email address is refused on the page, before any code is sent", async () => {
  session = null;
  const container = await setup();
  await click(button(container, "Check device code"));
  await input(container, "UNT email", "student@gmail.com");
  await click(button(container, "Send sign-in code"));
  expect(container.textContent).toContain("Use a UNT email address ending in @unt.edu or @my.unt.edu.");
  expect(container.querySelector('input[name="email"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(container.querySelector('input[name="email"]'));
  expect(requests.some((request) => request.path.endsWith("send-verification-otp"))).toBe(false);
  await input(container, "UNT email", "student@my.unt.edu");
  expect(container.querySelector('input[name="email"]')?.getAttribute("aria-invalid")).not.toBe("true");
  await click(button(container, "Send sign-in code"));
  expect(requests.filter((request) => request.path.endsWith("send-verification-otp"))).toHaveLength(1);
});

test("the mobile app is told to return to the app once approved", async () => {
  details = { clientKind: "mobile", scopes: ["documents:read", "documents:write"], userCode: "ABCDEFGH", scheduleId: "" };
  const container = await setup();
  await click(button(container, "Check device code"));
  await click(button(container, "Approve device"));
  expect(container.textContent).toContain("Return to the app.");
  expect(container.textContent).not.toContain("class search");
});
