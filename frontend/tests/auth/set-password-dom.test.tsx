import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installDom, mount, removeDom } from "../ui/dom";
import type { SetPasswordResult } from "@/components/shell/SetPasswordDialog";

// "Set a password" from the account menu, with the server call faked.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

async function render(result: SetPasswordResult) {
  const { SetPasswordDialog } = await import("@/components/shell/SetPasswordDialog");
  const calls: string[] = [];
  const view = await mount(
    <SetPasswordDialog
      open
      onOpenChange={() => {}}
      setPassword={async (password) => {
        calls.push(password);
        return result;
      }}
    />,
  );
  return { ...view, calls };
}

async function typeAndSubmit(value: string) {
  const { act } = await import("react");
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    document.querySelector("form#set-password-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return input;
}

const helpFor = (input: HTMLInputElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("Set a password", () => {
  test("a short password is refused without calling the server", async () => {
    const view = await render({ ok: true });
    const input = await typeAndSubmit("short");
    expect(view.calls).toHaveLength(0);
    expect(helpFor(input)).toBe("Use at least 8 characters.");
    await view.unmount();
  });

  test("a set password says how to use it", async () => {
    const view = await render({ ok: true });
    await typeAndSubmit("long enough password");
    expect(view.calls).toEqual(["long enough password"]);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Use a password instead");
    await view.unmount();
  });

  test("an account that already has one is told how to change it", async () => {
    const view = await render({ ok: false, code: "PASSWORD_ALREADY_SET" });
    const input = await typeAndSubmit("long enough password");
    expect(helpFor(input)).toContain("already has a password");
    await view.unmount();
  });
});
