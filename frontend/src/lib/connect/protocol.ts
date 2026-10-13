export const CHANNEL = "untangle-connect";
export const VERSION = 1;
// Matches the existing importer's 12 MiB limit; larger reports use manual upload.
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 1_000_000;
export const REQUEST_TIMEOUT_MS = 90_000;
export const HELLO_TIMEOUT_MS = 1_500;
export const reasons = ["NO_REPORT", "AMBIGUOUS_REPORT", "BUSY", "DOWNLOAD_FAILED", "UNSUPPORTED_REPORT", "INVALID_PDF", "TOO_LARGE", "TIMEOUT", "DISCONNECTED", "NO_EXTENSION"] as const;
export type Reason = typeof reasons[number];
export type SectionRow = { course: string; section: string; days: string; times: string; room: string; instructor: string; status: string };
export type Payload = { kind: "pdf"; base64: string } | { kind: "transcript-text"; text: string } | { kind: "sections"; rows: SectionRow[] };
type Envelope = { channel: typeof CHANNEL; version: typeof VERSION; nonce: string };
export type Request = Envelope & { from: "app" } & ({ type: "hello" } | { type: "request"; resource: "transcript" | "sections" } | { type: "cancel" });
export type Response = Envelope & { from: "extension" } & (
  { type: "capabilities"; resources: ("transcript" | "sections")[] } |
  { type: "progress"; stage: "waiting" | "reading" } |
  { type: "result"; payload: Payload } |
  { type: "error"; reason: Reason }
);
export type Message = Request | Response;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export function validPayload(v: unknown): v is Payload {
  if (!record(v)) return false;
  if (v.kind === "pdf") return bounded(v.base64, Math.ceil(MAX_PDF_BYTES / 3) * 4) && v.base64.length >= 8 && v.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v.base64);
  if (v.kind === "transcript-text") return bounded(v.text, MAX_TEXT_LENGTH) && v.text.trim().length > 0;
  if (v.kind === "sections") return Array.isArray(v.rows) && v.rows.length <= 1000 && v.rows.every(row => record(row) && ["course", "section", "days", "times", "room", "instructor", "status"].every(key => bounded(row[key], 500)));
  return false;
}
export function parseMessage(v: unknown): Message | null {
  if (!record(v) || v.channel !== CHANNEL || v.version !== VERSION || typeof v.nonce !== "string" || !/^[a-f0-9-]{36}$/i.test(v.nonce)) return null;
  const envelope: Envelope = { channel: CHANNEL, version: VERSION, nonce: v.nonce };
  if (v.from === "app") {
    if (v.type === "hello" || v.type === "cancel") return { ...envelope, from: "app", type: v.type };
    if (v.type === "request" && (v.resource === "transcript" || v.resource === "sections")) return { ...envelope, from: "app", type: "request", resource: v.resource };
  }
  if (v.from === "extension") {
    if (v.type === "capabilities" && Array.isArray(v.resources) && v.resources.every(r => r === "transcript" || r === "sections")) return { ...envelope, from: "extension", type: "capabilities", resources: v.resources };
    if (v.type === "progress" && (v.stage === "waiting" || v.stage === "reading")) return { ...envelope, from: "extension", type: "progress", stage: v.stage };
    if (v.type === "error") {
      const reason = reasons.find(reason => reason === v.reason);
      if (reason) return { ...envelope, from: "extension", type: "error", reason };
    }
    if (v.type === "result" && validPayload(v.payload)) return { ...envelope, from: "extension", type: "result", payload: v.payload };
  }
  return null;
}
export function acceptsResponse(event: Pick<MessageEvent, "source" | "origin" | "data">, source: unknown, origin: string, nonce: string): Response | null {
  if (event.source !== source || event.origin !== origin) return null;
  const message = parseMessage(event.data);
  return message?.from === "extension" && message.nonce === nonce ? message : null;
}
export function request(nonce: string, body: { type: "hello" } | { type: "cancel" } | { type: "request"; resource: "transcript" | "sections" }): Request {
  return { channel: CHANNEL, version: VERSION, from: "app", nonce, ...body };
}
type ResponseBody<T = Response> = T extends Response ? Omit<T, keyof Envelope | "from"> : never;
export function response(nonce: string, body: ResponseBody): Response {
  return { channel: CHANNEL, version: VERSION, from: "extension", nonce, ...body };
}
