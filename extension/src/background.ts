import { APP_ORIGINS, pageKind } from "./config";
import { parseMessage, response, REQUEST_TIMEOUT_MS, validPayload, type Response } from "../../frontend/src/lib/connect/protocol";
type Pending = { port: chrome.runtime.Port; nonce: string; resource: "transcript" | "sections"; timer: ReturnType<typeof setTimeout>; reportTab?: number };
let pending: Pending | undefined;
function finish(message?: Response) {
  const current = pending;
  pending = undefined;
  if (!current) return;
  clearTimeout(current.timer);
  if (current.reportTab !== undefined) void chrome.tabs.sendMessage(current.reportTab, { type: "cancel", nonce: current.nonce }).catch(() => {});
  if (message) current.port.postMessage(message);
}
async function readOpenPage() {
  const current = pending;
  if (!current || current.reportTab !== undefined) return;
  const tabs = await chrome.tabs.query({});
  if (pending !== current || current.reportTab !== undefined) return;
  const candidates = tabs.filter(t => t.id !== undefined && t.url && pageKind(t.url, __DEV__) === current.resource);
  const ready = await Promise.all(candidates.map(async tab => {
    try { const probe = await chrome.tabs.sendMessage(tab.id!, { type: "probe" }); return probe?.ready === true ? tab : null; }
    catch { return null; }
  }));
  if (pending !== current || current.reportTab !== undefined) return;
  const matches = ready.filter(tab => tab !== null);
  if (matches.length > 1) { finish(response(current.nonce, { type: "error", reason: "AMBIGUOUS_REPORT" })); return; }
  const tab = matches[0];
  if (!tab?.id) return;
  // Never navigate or create a portal tab. Only read a matching page already opened by the student.
  current.reportTab = tab.id;
  current.port.postMessage(response(current.nonce, { type: "progress", stage: "reading" }));
  try {
    const result: unknown = await chrome.tabs.sendMessage(tab.id, { type: "read", nonce: current.nonce, resource: current.resource });
    if (pending !== current) return;
    const message = parseMessage(result);
    if (!message || message.from !== "extension" || message.nonce !== current.nonce || (message.type !== "error" && message.type !== "result")) throw new Error("Invalid report response");
    if (message.type === "result" && (!validPayload(message.payload) || (current.resource === "sections") !== (message.payload.kind === "sections"))) throw new Error("Unexpected report resource");
    finish(message);
  } catch {
    if (pending === current) finish(response(current.nonce, { type: "error", reason: "UNSUPPORTED_REPORT" }));
  }
}
function receive(port: chrome.runtime.Port, raw: unknown) {
  const message = parseMessage(raw);
  if (!message || message.from !== "app") return;
  if (message.type === "hello") { port.postMessage(response(message.nonce, { type: "capabilities", resources: ["transcript", "sections"] })); return; }
  if (message.type === "cancel") { if (pending?.port === port && pending.nonce === message.nonce) finish(); return; }
  if (pending) { port.postMessage(response(message.nonce, { type: "error", reason: "BUSY" })); return; }
  pending = { port, nonce: message.nonce, resource: message.resource, timer: setTimeout(() => finish(response(message.nonce, { type: "error", reason: "TIMEOUT" })), REQUEST_TIMEOUT_MS) };
  port.postMessage(response(message.nonce, { type: "progress", stage: "waiting" }));
  void readOpenPage();
}
chrome.runtime.onConnect.addListener(port => {
  const sender = port.sender;
  if (port.name !== "untangle-app" || sender?.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) { port.disconnect(); return; }
  const url = new URL(sender.url);
  if (!APP_ORIGINS.includes(url.origin) || url.pathname !== "/connect") { port.disconnect(); return; }
  port.onMessage.addListener(raw => receive(port, raw));
  port.onDisconnect.addListener(() => { if (pending?.port === port) finish(); });
});
chrome.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (raw && typeof raw === "object" && "type" in raw && raw.type === "status" && !sender.tab) {
    reply({ waiting: Boolean(pending), resource: pending?.resource });
    return;
  }
  if (raw && typeof raw === "object" && "type" in raw && (raw.type === "page-ready" || raw.type === "send") && sender.frameId === 0 && sender.url && sender.tab?.id !== undefined && pageKind(sender.url, __DEV__)) {
    reply({ waiting: Boolean(pending) });
    void readOpenPage();
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (pending?.reportTab === tabId) finish(response(pending.nonce, { type: "error", reason: "NO_REPORT" }));
});
