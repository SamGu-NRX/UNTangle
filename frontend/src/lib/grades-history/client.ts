import { GradesError, malformed, NoHistoryError } from "./errors";
import { gradesLimiter } from "./limiter";
import type { GradesRequestLimiter } from "./limiter";

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
    if ("structuredContent" in result) malformed("tool error result", "error content without structured success data");
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
  const header = value.trim();
  if (/^\d+$/.test(header)) {
    const ms = Number(header) * 1_000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const imf = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (0[1-9]|[12]\d|3[01]) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) GMT$/;
  const obsolete = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (0[1-9]|[12]\d|3[01])-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) GMT$/;
  const asctime = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (\d{4})$/;
  const standard = imf.exec(header) ?? obsolete.exec(header);
  const ascii = standard ? null : asctime.exec(header);
  const fields = standard
    ? { weekday: standard[1], day: standard[2], month: standard[3], year: standard[4], hour: standard[5], minute: standard[6], second: standard[7] }
    : ascii ? { weekday: ascii[1], day: ascii[3], month: ascii[2], year: ascii[7], hour: ascii[4], minute: ascii[5], second: ascii[6] } : null;
  if (!fields) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  const second = Number(fields.second);
  let year = Number(fields.year);
  if (fields.year.length === 2) {
    const currentYear = new Date(now).getUTCFullYear();
    year += Math.floor(currentYear / 100) * 100;
    if (year > currentYear + 50) year -= 100;
  }
  // HTTP dates are UTC even when asctime omits GMT; local-time parsing changes the cooldown.
  // setUTCFullYear also preserves years 0000-0099 instead of Date.UTC's 1900 offset.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second || weekdays[date.getUTCDay()] !== fields.weekday.slice(0, 3)) return null;
  return Math.max(0, date.getTime() - now);
}

async function readSseResult(response: Response, id: number): Promise<Record<string, unknown>> {
  if (!response.body) malformed("SSE response", "a readable body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0 || (!chunk.done && buffer[end] === "\r" && end === buffer.length - 1)) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1));
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        if (line !== "" || data.length === 0) continue;
        const body = data.join("\n");
        data = [];
        let value: unknown;
        try { value = JSON.parse(body); } catch { malformed("SSE JSON-RPC event", "valid JSON"); }
        const rpc = object(value, "SSE JSON-RPC event");
        if (rpc.jsonrpc !== "2.0") malformed("SSE JSON-RPC version", "2.0");
        if (!("id" in rpc)) {
          if (typeof rpc.method !== "string" || "result" in rpc || "error" in rpc) malformed("SSE notification", "a JSON-RPC method without a result/error");
          continue;
        }
        if (rpc.id === id) return parseRpc(body, id);
      }
      if (chunk.done) malformed("SSE response", `a completed JSON-RPC event with matching id ${id}`);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

export class GradesMcpClient {
  private id = 0;
  constructor(private readonly options: { endpoint?: string; fetch?: typeof fetch; limiter?: GradesRequestLimiter; now?: () => number; timeoutMs?: number } = {}) {}

  async rpc(method: "tools/list" | "tools/call", params: object): Promise<Record<string, unknown>> {
    const limiter = this.options.limiter ?? gradesLimiter;
    await limiter.acquire();
    const id = ++this.id;
    let response: Response;
    const controller = new AbortController();
    try {
      response = await (this.options.fetch ?? fetch)(this.options.endpoint ?? MCP_ENDPOINT, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        // A stalled upstream request must eventually become unavailable.
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.options.timeoutMs ?? 15_000)]),
      });
      if (response.status === 429 || response.status === 503) {
        // Missing/invalid Retry-After uses a conservative minute cooldown, not an immediate retry.
        const wait = retryAfterMs(response.headers.get("Retry-After"), (this.options.now ?? Date.now)()) ?? 60_000;
        await limiter.cooldown(wait);
        throw new GradesError(response.status === 429 ? "throttled" : "upstream", `untgrades.app HTTP ${response.status}`, Math.ceil(wait / 1_000));
      }
      if (!response.ok) throw new GradesError("upstream", `untgrades.app HTTP ${response.status}`);
      if (response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream")) return await readSseResult(response, id);
      return parseRpc(await response.text(), id);
    } catch (error) {
      if (error instanceof GradesError) throw error;
      throw new GradesError("upstream", `untgrades.app transport failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Also close the HTTP request after reader cancellation, including runtimes that keep its socket open.
      controller.abort();
    }
  }

  async call<K extends keyof ToolArguments>(name: K, args: ToolArguments[K]): Promise<unknown> {
    return parseToolResult(await this.rpc("tools/call", { name, arguments: args }), name);
  }
}
