import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installDom, mount, removeDom } from "../ui/dom";

// The sign-in link page's form, rendered from a URL fragment: nothing is
// requested on load, and the form submits the fragment's fields to verify.

let requests: string[] = [];
let realFetch: typeof fetch;

beforeAll(() => {
  installDom();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response("{}");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  removeDom();
});

async function renderAt(hash: string) {
  requests = [];
  window.location.hash = hash;
  const { SignInLinkForm } = await import("@/components/sign-in-link-form");
  const view = await mount(<SignInLinkForm />);
  // Give any effect a chance to fire a request.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return view;
}

describe("the sign-in link page", () => {
  test("renders from the fragment without requesting anything, and its form targets verify with the link's fields", async () => {
    const view = await renderAt("#token=abc123&callbackURL=%2Fcourses&errorCallbackURL=%2Fauth%3Flink%3Dfailed&extra=ignored");
    expect(requests).toEqual([]);
    const form = view.container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/api/auth/magic-link/verify");
    const fields = Object.fromEntries(
      [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((input) => [input.name, input.value]),
    );
    expect(fields).toEqual({ token: "abc123", callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe("Sign in");
    // The token never leaves this page through a custom scheme: any app can
    // register untangle:// and would receive it.
    const links = [...view.container.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "");
    expect(links.filter((href) => !href.startsWith("/"))).toEqual([]);
    expect(view.container.innerHTML).not.toContain("untangle://");
    await view.unmount();
  });

  test("without a token it says the link is incomplete and has no form", async () => {
    const view = await renderAt("#callbackURL=%2Fcourses");
    expect(view.container.querySelector("form")).toBeNull();
    expect(view.container.textContent).toContain("incomplete");
    await view.unmount();
  });
});
