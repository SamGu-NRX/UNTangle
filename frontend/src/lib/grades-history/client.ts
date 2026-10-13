import { GradesError, malformed, NoHistoryError } from "./errors";
import { gradesLimiter, GradesLimiter } from "./limiter";

export const MCP_ENDPOINT = "https://www.untgrades.app/api/mcp";
export type ToolArguments = {
  search_grades: { query: string };
  get_course_grades: { prefix: string; number: string; offset?: number; limit?: number };
  get_instructor_courses: { firstName: string; lastName: string; offset?: number; limit?: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) malformed(path, "an object");
  return value;
}

export function parseRpc(body: string, id: number): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(body); } catch { malformed("JSON-RPC body", "valid JSON"); }
  const rpc = object(value, "JSON-RPC envelope");
  if (rpc.jsonrpc !== "2.0" || rpc.id !== id) malformed("JSON-RPC version/id", `2.0 with matching id ${id}`);
  if ("error" in rpc) {
    const error = object(rpc.error, "JSON-RPC error");
    if (!Number.isInteger(error.code) || typeof error.message !== "string" || "result" in rpc) malformed("JSON-RPC error", "a code/message without result");
    throw new GradesError("upstream", `untgrades.app JSON-RPC error ${error.code}: ${error.message}`);
  }
  return object(rpc.result, "JSON-RPC result");
}

export function parseToolResult(result: Record<string, unknown>, tool?: keyof ToolArguments): unknown {
  if (result.isError !== undefined && typeof result.isError !== "boolean") malformed("tool isError", "a boolean");
  if (!Array.isArray(result.content)) malformed("tool content", "an array");
  const texts = result.content.map((entry, i) => {
    const block = object(entry, `content[${i}]`);
    if (block.type !== "text" || typeof block.text !== "string") malformed(`content[${i}]`, "a text block");
    return block.text;
  });
  if (result.isError) {
    // This exact source response was captured in missing.json. Other tool errors are failures.
    if (tool === "get_course_grades" && texts.length === 1 && texts[0] === "Course not found") throw new NoHistoryError("Course not found");
    throw new GradesError("upstream", `untgrades.app tool error: ${texts.join("; ")}`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (texts.length !== 1) malformed("tool content", "one JSON text block when structuredContent is absent");
  try { return JSON.parse(texts[0]); } catch { malformed("tool text", "valid JSON"); }
}

export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const ms = Math.ceil(Number(value) * 1_000);
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class GradesMcpClient {
  private id = 0;
  constructor(private readonly options: { endpoint?: string; fetch?: typeof fetch; limiter?: GradesLimiter; now?: () => number; timeoutMs?: number } = {}) {}

  async rpc(method: "tools/list" | "tools/call", params: object): Promise<Record<string, unknown>> {
    const limiter = this.options.limiter ?? gradesLimiter;
    await limiter.acquire();
    const id = ++this.id;
    let response: Response;
    let body: string;
    try {
      response = await (this.options.fetch ?? fetch)(this.options.endpoint ?? MCP_ENDPOINT, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        // A stalled upstream request must eventually become unavailable.
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
      if (response.status === 429 || response.status === 503) {
        // Missing/invalid Retry-After uses a conservative minute cooldown, not an immediate retry.
        const wait = retryAfterMs(response.headers.get("Retry-After"), (this.options.now ?? Date.now)()) ?? 60_000;
        limiter.cooldown(wait);
        throw new GradesError(response.status === 429 ? "throttled" : "upstream", `untgrades.app HTTP ${response.status}`, Math.ceil(wait / 1_000));
      }
      if (!response.ok) throw new GradesError("upstream", `untgrades.app HTTP ${response.status}`);
      body = await response.text();
    } catch (error) {
      if (error instanceof GradesError) throw error;
      throw new GradesError("upstream", `untgrades.app transport failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
      const events = body.replace(/\r\n/g, "\n").split("\n\n").map((event) => event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")).filter(Boolean);
      if (events.length !== 1) malformed("SSE response", "one JSON-RPC data event");
      body = events[0];
    }
    return parseRpc(body, id);
  }

  async call<K extends keyof ToolArguments>(name: K, args: ToolArguments[K]): Promise<unknown> {
    return parseToolResult(await this.rpc("tools/call", { name, arguments: args }), name);
  }
}
