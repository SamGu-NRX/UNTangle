/**
 * The page side of a write, through the DOM: each dialog answers only its
 * own question, and ending a registration (sign-out, another student,
 * unmount) closes its question and takes back its Undo.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { PlannerPort, ToolResult } from "@/lib/webmcp/tools";
import { click, installDom, mount, removeDom } from "../ui/dom";
import { fixturePort } from "./fixture";

type Execute = (input: unknown, second?: unknown) => Promise<ToolResult>;

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
});

async function session(port: PlannerPort) {
  const { act } = await import("react");
  const { WebMcpSession } = await import("@/components/webmcp/WebMcpBridge");
  const { Toaster } = await import("@/components/ui/Toast");
  const tools = new Map<string, Execute>();
  const modelContext = {
    registerTool: (definition: { name: string; execute: Execute }) => {
      tools.set(definition.name, definition.execute);
      return Promise.resolve();
    },
  };
  Object.defineProperty(document, "modelContext", { value: modelContext, configurable: true });
  const tree = (ready: boolean) => (
    <>
      <WebMcpSession ready={ready} port={port} />
      <Toaster />
    </>
  );
  const view = await mount(tree(true));
  unmount = view.unmount;
  return {
    /** Starts a tool call that waits for the student, once the page has rendered the question; `done` is its answer. */
    start: async (name: string, input: unknown) => {
      let done: Promise<ToolResult> = Promise.resolve({ ok: false, reason: "failed" });
      await act(async () => {
        done = tools.get(name)!(input);
      });
      // Wrapped: returning the bare promise from an async function would wait for the student's answer.
      return { done };
    },
    setReady: (ready: boolean) => view.rerender(tree(ready)),
  };
}

const dialog = () => document.querySelector('[role="alertdialog"]');
const button = (label: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.querySelector(".ui-btn__label")?.textContent === label) as HTMLButtonElement;
const planned = (port: PlannerPort, code: string) => port.plan().courseStatuses[code] === "inProgress";
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

describe("the confirmation dialog", () => {
  test("a control from an earlier question cannot answer the next one", async () => {
    const { port } = fixturePort();
    const page = await session(port);
    const { done: first } = await page.start("remove_course", { code: "PSYC 1630" });
    expect(dialog()?.textContent).toContain("Remove PSYC 1630");
    const firstRemove = button("Remove");
    await click(firstRemove);
    expect(await first).toMatchObject({ ok: true, removed: "PSYC 1630" });
    expect(firstRemove.disabled).toBe(true);

    const { done: second } = await page.start("remove_course", { code: "ENGL 1310" });
    expect(dialog()?.textContent).toContain("Remove ENGL 1310");
    await click(firstRemove);
    expect(planned(port, "ENGL 1310")).toBe(true);
    await settle();
    expect(document.activeElement).toBe(button("Cancel"));
    await click(button("Cancel"));
    expect(await second).toEqual({ ok: false, reason: "declined" });
    expect(planned(port, "ENGL 1310")).toBe(true);
  });
});

describe("ending a registration", () => {
  test("answers the open question with no", async () => {
    const { port, writes } = fixturePort();
    const page = await session(port);
    const { done: pending } = await page.start("remove_course", { code: "PSYC 1630" });
    await page.setReady(false);
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(writes).toEqual([]);
  });

  test("takes back the Undo it offered", async () => {
    const { port } = fixturePort();
    const page = await session(port);
    const { done } = await page.start("remove_course", { code: "PSYC 1630" });
    await click(button("Remove"));
    expect(await done).toMatchObject({ ok: true });
    await settle();
    expect(document.querySelector(".ui-toast__action")?.textContent).toBe("Undo");
    await page.setReady(false);
    await settle();
    expect(document.querySelector(".ui-toast__action")).toBeNull();
    expect(planned(port, "PSYC 1630")).toBe(false);
  });
});
