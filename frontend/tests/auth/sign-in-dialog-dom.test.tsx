import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installDom, mount, press, removeDom } from "../ui/dom";
import type { AuthApi } from "@/components/auth-client";

// The sign-in form over the current page: opened by a Sign in link, closed
// by Escape, a route change or a session arriving, with focus going back to
// the link. The server calls are faked.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const api: AuthApi = { sendLink: async () => ({ error: null }), signIn: async () => ({ error: null }) };

type Props = { pathname?: string; signedIn?: boolean; link?: boolean };

async function render(props: Props = {}) {
  const { SignInLayer } = await import("@/components/auth-client");
  const { openSignIn } = await import("@/components/auth-shell");
  const ui = (p: Props) => (
    <>
      {p.link === false ? null : (
        <a href="/auth" onClick={openSignIn}>
          Sign in
        </a>
      )}
      <SignInLayer api={api} pathname={p.pathname ?? "/courses"} signedIn={p.signedIn ?? false} />
    </>
  );
  const view = await mount(ui(props));
  const link = view.container.querySelector("a")!;
  return { ...view, link, update: (next: Props) => view.rerender(ui(next)) };
}

async function openFrom(link: HTMLAnchorElement) {
  const { act } = await import("react");
  link.focus();
  let followed = true;
  // On document, so it runs after React's handler on the root.
  document.addEventListener("click", (event) => (followed = !event.defaultPrevented), { once: true });
  await act(async () => link.click());
  // Let the layer's focus move run.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return { followed };
}

async function settle(ms: number) {
  const { act } = await import("react");
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe("Sign in over the current page", () => {
  test("the link opens the form in a dialog instead of going to /auth, named by its heading, with Email focused", async () => {
    const view = await render();
    const { followed } = await openFrom(view.link);
    expect(followed).toBe(false);
    const box = dialog();
    expect(box !== null).toBe(true);
    expect(document.getElementById(box!.getAttribute("aria-labelledby")!)?.textContent).toBe("Sign in");
    const email = document.activeElement as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("username");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    // The page behind can't be reached while the dialog is up.
    expect(view.container.closest("[inert]") !== null).toBe(true);
    await view.unmount();
  });

  test("Escape closes it, focus returns to Sign in, and nothing of it is left to Tab to", async () => {
    const view = await render();
    await openFrom(view.link);
    await press(document.activeElement!, "Escape");
    await settle(200);
    expect(dialog() === null).toBe(true);
    expect(document.activeElement === view.link).toBe(true);
    expect(document.querySelectorAll("input, button").length).toBe(0);
    expect(view.container.closest("[inert]") === null).toBe(true);
    await view.unmount();
  });

  test("the password field asks for the current password", async () => {
    const view = await render();
    await openFrom(view.link);
    const { click } = await import("../ui/dom");
    const usePassword = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Use a password instead"))!;
    await click(usePassword);
    const password = document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]');
    expect(password?.type).toBe("password");
    await view.unmount();
  });

  test("moving to another page closes it", async () => {
    const view = await render();
    await openFrom(view.link);
    await view.update({ pathname: "/forgot-password" });
    await settle(200);
    expect(dialog() === null).toBe(true);
    await view.unmount();
  });

  test("a session arriving closes it", async () => {
    const view = await render();
    await openFrom(view.link);
    await view.update({ signedIn: true });
    await settle(200);
    expect(dialog() === null).toBe(true);
    await view.unmount();
  });

  test("once signed in the Sign in link is gone, so focus lands on the page's main", async () => {
    const main = document.createElement("main");
    main.id = "main";
    main.tabIndex = -1;
    document.body.appendChild(main);
    const view = await render();
    await openFrom(view.link);
    // The bar swaps Sign in for the account menu as the session lands.
    await view.update({ signedIn: true, link: false });
    await settle(200);
    expect(dialog() === null).toBe(true);
    expect(`${document.activeElement?.tagName}#${document.activeElement?.id}`).toBe("MAIN#main");
    await view.unmount();
    main.remove();
  });

  test("a modified click follows the link to /auth", async () => {
    const view = await render();
    const { act } = await import("react");
    let followed = false;
    document.addEventListener("click", (event) => (followed = !event.defaultPrevented), { once: true });
    await act(async () => {
      view.link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    });
    expect(followed).toBe(true);
    expect(dialog() === null).toBe(true);
    await view.unmount();
  });
});
