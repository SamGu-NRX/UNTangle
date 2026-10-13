import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, removeDom } from "../ui/dom";
import type { AuthApi } from "@/components/auth-client";

// The sign-in page through the DOM, with its three server calls faked.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

type Call = [keyof AuthApi, ...string[]];

function fakeApi(results: Partial<Record<keyof AuthApi, { error: { message?: string } | null }>> = {}) {
  const calls: Call[] = [];
  const ok = { error: null };
  const api: AuthApi = {
    sendLink: async (email) => (calls.push(["sendLink", email]), results.sendLink ?? ok),
    signIn: async (email, password) => (calls.push(["signIn", email, password]), results.signIn ?? ok),
    signUp: async (email, password, name) => (calls.push(["signUp", email, password, name]), results.signUp ?? ok),
  };
  return { api, calls };
}

async function render(api: AuthApi, opts: { emailInServerLog?: boolean; linkFailed?: boolean } = {}) {
  const { AuthPanel } = await import("@/components/auth-client");
  let continued = 0;
  const view = await mount(
    <AuthPanel
      api={api}
      onContinue={() => (continued += 1)}
      emailInServerLog={opts.emailInServerLog ?? false}
      linkFailed={opts.linkFailed ?? false}
    />,
  );
  return { ...view, continued: () => continued };
}

async function type(input: HTMLInputElement, value: string) {
  const { act } = await import("react");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(container: HTMLElement) {
  const { act } = await import("react");
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const field = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.textContent?.trim().startsWith(label))
    ?.control as HTMLInputElement;
/** A ui Button's visible label (a button that can load also carries its hidden loading label). */
const label = (b: HTMLButtonElement) =>
  (b.querySelector(".ui-btn__label:not(.ui-btn__label--loading)")?.textContent ?? b.textContent ?? "").trim();
const button = (container: HTMLElement, name: string | RegExp) =>
  [...container.querySelectorAll("button")].find((b) =>
    typeof name === "string" ? label(b) === name : name.test(label(b)),
  ) as HTMLButtonElement;
const helpFor = (input: HTMLInputElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("sign-in by emailed link", () => {
  test("leads with the email field and 'Email me a sign-in link'; a password is the secondary path", async () => {
    const { api } = fakeApi();
    const view = await render(api);
    expect(view.container.querySelector("h1")?.textContent).toBe("Sign in");
    expect(field(view.container, "UNT email")).toBeTruthy();
    expect(field(view.container, "Password")).toBeUndefined();
    expect(button(view.container, "Email me a sign-in link").type).toBe("submit");
    expect(button(view.container, "Use a password instead")).toBeTruthy();
    await view.unmount();
  });

  test("a sent link shows 'Check your UNT email' and a resend that cools down", async () => {
    const { api, calls } = fakeApi();
    const view = await render(api);
    await type(field(view.container, "UNT email"), " eagle@my.unt.edu ");
    await submit(view.container);
    expect(calls).toEqual([["sendLink", "eagle@my.unt.edu"]]);
    expect(view.container.querySelector("h1")?.textContent).toBe("Check your UNT email");
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("eagle@my.unt.edu");
    const resend = button(view.container, /^Resend link in \d+s$/);
    expect(resend.disabled).toBe(true);
    expect(button(view.container, "Use a password instead")).toBeTruthy();
    await view.unmount();
  });

  test("a failed request keeps the form and puts the server's reason under the email field", async () => {
    const { api } = fakeApi({ sendLink: { error: { message: "Too many requests. Try again in a minute." } } });
    const view = await render(api);
    const email = field(view.container, "UNT email");
    await type(email, "eagle@my.unt.edu");
    await submit(view.container);
    expect(view.container.querySelector("h1")?.textContent).toBe("Sign in");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(helpFor(email)).toBe("Too many requests. Try again in a minute.");
    await view.unmount();
  });

  test("a non-UNT address is refused without calling the server", async () => {
    const { api, calls } = fakeApi();
    const view = await render(api);
    const email = field(view.container, "UNT email");
    await type(email, "eagle@gmail.com");
    await submit(view.container);
    expect(calls).toHaveLength(0);
    expect(helpFor(email)).toContain("@unt.edu");
    await view.unmount();
  });

  test("in development without email, the page says the link is in the server log", async () => {
    const { api } = fakeApi();
    const view = await render(api, { emailInServerLog: true });
    expect(view.container.textContent).toContain("Email isn't set up here; the link is in the server log.");
    await type(field(view.container, "UNT email"), "eagle@my.unt.edu");
    await submit(view.container);
    expect(view.container.textContent).toContain("the link is in the server log");
    await view.unmount();
  });

  test("returning from a used or expired link says so under the email field", async () => {
    const { api } = fakeApi();
    const view = await render(api, { linkFailed: true });
    expect(helpFor(field(view.container, "UNT email"))).toContain("expired or was already used");
    await view.unmount();
  });
});

describe("the password path", () => {
  test("password sign-in still works and continues to the plan", async () => {
    const { api, calls } = fakeApi();
    const view = await render(api);
    await click(button(view.container, "Use a password instead"));
    await type(field(view.container, "UNT email"), "eagle@my.unt.edu");
    await type(field(view.container, "Password"), "long enough password");
    await submit(view.container);
    expect(calls).toEqual([["signIn", "eagle@my.unt.edu", "long enough password"]]);
    expect(view.continued()).toBe(1);
    await view.unmount();
  });

  test("a wrong password shows under Password", async () => {
    const { api } = fakeApi({ signIn: { error: { message: "Invalid email or password" } } });
    const view = await render(api);
    await click(button(view.container, "Use a password instead"));
    await type(field(view.container, "UNT email"), "eagle@my.unt.edu");
    const password = field(view.container, "Password");
    await type(password, "long enough password");
    await submit(view.container);
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(helpFor(password)).toBe("Invalid email or password");
    expect(view.continued()).toBe(0);
    await view.unmount();
  });

  test("creating an account says a verification link was sent", async () => {
    const { api, calls } = fakeApi();
    const view = await render(api);
    await click(button(view.container, "Use a password instead"));
    await click(view.container.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')!);
    await type(field(view.container, "UNT email"), "new@my.unt.edu");
    await type(field(view.container, "Password"), "long enough password");
    await submit(view.container);
    expect(calls[0][0]).toBe("signUp");
    expect(view.container.querySelector("h1")?.textContent).toBe("Verify your email");
    await view.unmount();
  });
});
