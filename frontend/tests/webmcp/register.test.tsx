/**
 * How the tools meet the browser: feature detection, the register and
 * unregister lifecycle on current and older WebMCP drafts, the confirmation
 * adapter, and the per-call guards (rate limit, one write at a time).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createLimiter, findModelContext, registerTools, type ModelContextLike, type Session } from "@/lib/webmcp/register";
import { createTools, type PlannerPort, type Tool, type ToolContext, type ToolResult } from "@/lib/webmcp/tools";
import { installDom, mount, removeDom } from "../ui/dom";

type Definition = { name: string; annotations: { readOnlyHint: boolean }; execute(input: unknown, second?: unknown): Promise<ToolResult> };

function stubContext({ olderDraft = false } = {}) {
  const registered = new Map<string, { definition: Definition; signal?: AbortSignal }>();
  const unregistered: string[] = [];
  const modelContext: ModelContextLike = {
    registerTool: (definition, options) => {
      registered.set(definition.name, { definition, signal: options?.signal });
      return Promise.resolve();
    },
    ...(olderDraft ? { unregisterTool: (name: string) => unregistered.push(name) } : {}),
  };
  return { modelContext, registered, unregistered };
}

const tool = (name: string, writes: boolean, run: (input: unknown, ctx: ToolContext) => Promise<ToolResult> = async () => ({ ok: true })): Tool => ({
  name,
  title: name,
  description: name,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  writes,
  run,
});

const session = (overrides: Partial<Session> = {}): Session => ({
  port: {} as PlannerPort,
  applied: () => {},
  ask: async () => true,
  ...overrides,
});

describe("feature detection", () => {
  test("finds nothing when neither document nor navigator has a model context", () => {
    expect(findModelContext({}, {})).toBeNull();
    expect(findModelContext({ modelContext: {} }, {})).toBeNull();
    expect(findModelContext(undefined, undefined)).toBeNull();
  });

  test("prefers document.modelContext and falls back to navigator.modelContext", () => {
    const current = stubContext().modelContext;
    const older = stubContext().modelContext;
    expect(findModelContext({ modelContext: current }, { modelContext: older })).toBe(current);
    expect(findModelContext({}, { modelContext: older })).toBe(older);
  });

  describe("in the page", () => {
    beforeAll(() => {
      installDom();
    });
    afterAll(() => {
      removeDom();
    });

    test("the shell's WebMcpTools renders nothing without WebMCP", async () => {
      const { WebMcpTools } = await import("@/components/webmcp/WebMcpTools");
      const view = await mount(<WebMcpTools />);
      expect(view.container.innerHTML).toBe("");
      await view.unmount();
    });
  });
});

describe("registration", () => {
  test("exposes exactly the planner tools, writes marked as not read-only", () => {
    const { modelContext, registered } = stubContext();
    registerTools(modelContext, createTools(), session());
    expect(Object.fromEntries([...registered].map(([name, { definition }]) => [name, definition.annotations.readOnlyHint]))).toEqual({
      search_courses: true,
      get_course: true,
      check_eligibility: true,
      get_schedule: true,
      get_day: true,
      build_schedule: true,
      export_class_numbers: true,
      apply_alternative: false,
      add_section: false,
      remove_course: false,
      set_busy_times: false,
    });
  });

  test("unregistering aborts the registration signal", () => {
    const { modelContext, registered, unregistered } = stubContext();
    const unregister = registerTools(modelContext, [tool("a", false), tool("b", true)], session());
    expect([...registered.values()].map(({ signal }) => signal?.aborted)).toEqual([false, false]);
    unregister();
    expect([...registered.values()].map(({ signal }) => signal?.aborted)).toEqual([true, true]);
    expect(unregistered).toEqual([]);
  });

  test("an older draft's unregisterTool is called by name", () => {
    const { modelContext, unregistered } = stubContext({ olderDraft: true });
    registerTools(modelContext, [tool("a", false), tool("b", true)], session())();
    expect(unregistered).toEqual(["a", "b"]);
  });
});

describe("calls", () => {
  const registeredExecute = (tools: Tool[], overrides: Partial<Session> = {}) => {
    const { modelContext, registered } = stubContext();
    registerTools(modelContext, tools, session(overrides));
    return (name: string) => registered.get(name)!.definition.execute;
  };

  test("a tool over its rate limit is not run", async () => {
    let runs = 0;
    const execute = registeredExecute([tool("a", false, async () => ({ ok: true, runs: ++runs }))], { limit: createLimiter(() => 0) });
    for (let i = 0; i < 30; i += 1) await execute("a")({});
    expect(await execute("a")({})).toEqual({ ok: false, reason: "rate_limited", detail: "Too many calls; wait a minute." });
    expect(runs).toBe(30);
  });

  test("a second write waits for no one: it is refused while the student is deciding", async () => {
    let answer: (granted: boolean) => void = () => {};
    const write = tool("w", true, async (_input, ctx) => ((await ctx.confirm("q", "a")) ? { ok: true } : { ok: false, reason: "declined" }));
    const execute = registeredExecute([write], { ask: () => new Promise((resolve) => (answer = resolve)) });
    const first = execute("w")({});
    expect(await execute("w")({})).toMatchObject({ ok: false, reason: "busy" });
    answer(true);
    expect(await first).toEqual({ ok: true });
    const third = execute("w")({});
    answer(false);
    expect(await third).toEqual({ ok: false, reason: "declined" });
  });

  test("the question runs inside an older draft's requestUserInteraction", async () => {
    const events: string[] = [];
    const ask = async () => (events.push("asked"), true);
    const client = {
      requestUserInteraction: async (callback: () => Promise<boolean>) => {
        events.push("paused");
        const result = await callback();
        events.push("resumed");
        return result;
      },
    };
    const write = tool("w", true, async (_input, ctx) => ({ ok: true, granted: await ctx.confirm("q", "a") }));
    expect(await registeredExecute([write], { ask })("w")({}, client)).toEqual({ ok: true, granted: true });
    expect(events).toEqual(["paused", "asked", "resumed"]);
  });

  test("the current draft's execution signal reaches the question", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const ask = async (_q: string, _a: string, signal?: AbortSignal) => ((seen = signal), false);
    const write = tool("w", true, async (_input, ctx) => ({ ok: true, granted: await ctx.confirm("q", "a") }));
    await registeredExecute([write], { ask })("w")({}, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  test("a tool that throws answers failed instead of rejecting", async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const execute = registeredExecute([tool("a", false, async () => Promise.reject(new Error("boom")))]);
    expect(await execute("a")({})).toEqual({ ok: false, reason: "failed" });
    quiet.mockRestore();
  });
});
