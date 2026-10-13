/**
 * Puts the tools from tools.ts in front of the browser's agent.
 *
 * Targets the WebMCP Draft Community Group Report of 13 October 2026
 * (https://webmachinelearning.github.io/webmcp/, repository commit eada13b):
 * `document.modelContext.registerTool(tool, { signal })` returns a promise,
 * aborting the signal unregisters, and `execute(input, { signal })` gets an
 * execution signal that ends when the agent cancels. Older drafts, which
 * Chrome's origin trial may still ship, differ in three ways handled here:
 * the API lived on `navigator.modelContext`, `unregisterTool(name)` existed
 * until March 2026, and until June 2026 `execute` received a client whose
 * `requestUserInteraction(callback)` let the agent pause for the user. The
 * current draft has no confirmation call at all; it only offers
 * `readOnlyHint`, so the page asks the student itself, inside
 * `requestUserInteraction` when the agent provides one.
 */
// Types only: a value import would pull the tools and their catalog data into the shell's bundle.
import type { Tool, ToolContext, ToolResult } from "./tools";

export type ModelContextLike = {
  registerTool(tool: RegisteredTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
};

type RegisteredTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute(input: unknown, second?: unknown): Promise<ToolResult>;
};

/** `document.modelContext`, or the older `navigator.modelContext`; null when the browser has neither. */
export function findModelContext(
  doc: object | undefined = globalThis.document,
  nav: object | undefined = globalThis.navigator,
): ModelContextLike | null {
  const candidate = (doc && "modelContext" in doc ? doc.modelContext : undefined) ?? (nav && "modelContext" in nav ? nav.modelContext : undefined);
  return isModelContext(candidate) ? candidate : null;
}

function isModelContext(value: unknown): value is ModelContextLike {
  return typeof value === "object" && value !== null && "registerTool" in value && typeof value.registerTool === "function";
}

/** The current draft's execution signal, when the agent passed one. */
function executionSignal(second: unknown): AbortSignal | undefined {
  return hasField(second, "signal") && second.signal instanceof AbortSignal ? second.signal : undefined;
}

/**
 * The student's answer, asked through the page. When the agent passed a
 * client with `requestUserInteraction` (drafts before June 2026), the
 * question runs inside it so the agent waits for the student.
 */
export function confirmThrough(
  second: unknown,
  signal: AbortSignal,
  ask: (question: string, action: string, signal: AbortSignal) => Promise<boolean>,
): ToolContext["confirm"] {
  return async (question, action) => {
    const granted = canPause(second)
      ? (await second.requestUserInteraction(() => ask(question, action, signal))) === true
      : await ask(question, action, signal);
    // A yes that arrives after the call was cancelled does not count.
    return granted && !signal.aborted;
  };
}

type PausingClient = { requestUserInteraction(callback: () => Promise<boolean>): Promise<unknown> };

function canPause(value: unknown): value is PausingClient {
  return hasField(value, "requestUserInteraction") && typeof value.requestUserInteraction === "function";
}

function hasField<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * Calls per tool per minute in this tab. Starting points with no usage data
 * behind them: build_schedule keeps a worker busy for up to 3.3 s per call.
 * TODO(untangle/abuse-limits): charge the per-user client budget from
 * lib/rate-limit once that branch lands on alpha.
 */
export const CALLS_PER_MINUTE: Record<string, number> = { build_schedule: 6 };
const DEFAULT_CALLS_PER_MINUTE = 30;

export function createLimiter(now: () => number = Date.now) {
  const calls = new Map<string, number[]>();
  return (name: string): boolean => {
    const at = now();
    const recent = (calls.get(name) ?? []).filter((time) => at - time < 60_000);
    const allowed = recent.length < (CALLS_PER_MINUTE[name] ?? DEFAULT_CALLS_PER_MINUTE);
    calls.set(name, allowed ? [...recent, at] : recent);
    return allowed;
  };
}

export type Session = Omit<ToolContext, "confirm" | "signal"> & {
  /** Asks the student; must answer false once `signal` aborts. */
  ask(question: string, action: string, signal: AbortSignal): Promise<boolean>;
  limit?: (name: string) => boolean;
};

/** Registers every tool; the returned function unregisters them. */
export function registerTools(modelContext: ModelContextLike, tools: readonly Tool[], session: Session): () => void {
  const controller = new AbortController();
  const limit = session.limit ?? createLimiter();
  // One confirmation at a time: a second write while the student is deciding is refused, not queued.
  let writing = false;

  for (const tool of tools) {
    const execute = async (input: unknown, second?: unknown): Promise<ToolResult> => {
      if (!limit(tool.name)) return { ok: false, reason: "rate_limited", detail: "Too many calls; wait a minute." };
      if (tool.writes && writing) return { ok: false, reason: "busy", detail: "The student is still answering another change." };
      writing ||= tool.writes;
      // Ends when the agent cancels this call or the tools are unregistered.
      const execution = executionSignal(second);
      const signal = execution ? AbortSignal.any([controller.signal, execution]) : controller.signal;
      try {
        const confirm = confirmThrough(second, signal, session.ask);
        return await tool.run(input, { port: session.port, applied: session.applied, signal, confirm });
      } catch (error) {
        console.error(`WebMCP tool ${tool.name} failed`, error);
        return { ok: false, reason: "failed" };
      } finally {
        if (tool.writes) writing = false;
      }
    };
    const definition: RegisteredTool = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: !tool.writes },
      execute,
    };
    try {
      Promise.resolve(modelContext.registerTool(definition, { signal: controller.signal })).catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn(`WebMCP tool ${tool.name} was not registered`, error);
      });
    } catch (error) {
      console.warn(`WebMCP tool ${tool.name} was not registered`, error);
    }
  }

  return () => {
    controller.abort();
    // Drafts before March 2026 ignore the signal and unregister by name.
    for (const tool of tools) {
      try {
        modelContext.unregisterTool?.(tool.name);
      } catch {
        // Already gone.
      }
    }
  };
}
