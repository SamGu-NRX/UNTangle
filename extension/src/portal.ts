import { pageKind } from "./config";
import { response } from "../../frontend/src/lib/connect/protocol";
import { extractSections, readReport, ReportError } from "./read-report";
const kind = pageKind(location.href, __DEV__);
if (kind && window === window.top) {
  let active: { nonce: string; controller: AbortController } | undefined;
  chrome.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !raw || typeof raw !== "object" || !("type" in raw) || !("nonce" in raw) || typeof raw.nonce !== "string") return;
    if (raw.type === "cancel") { if (active?.nonce === raw.nonce) active.controller.abort(); return; }
    if (raw.type !== "read" || !("resource" in raw) || raw.resource !== kind) return;
    const nonce = raw.nonce;
    active?.controller.abort();
    const controller = new AbortController();
    active = { nonce, controller };
    const task = kind === "sections" ? Promise.resolve({ kind: "sections" as const, rows: extractSections(document) }) : readReport(document, location.href, __DEV__, controller.signal);
    void task.then(payload => reply(response(nonce, { type: "result", payload }))).catch(error => reply(response(nonce, { type: "error", reason: error instanceof ReportError ? error.reason : "DOWNLOAD_FAILED" }))).finally(() => { if (active?.nonce === nonce) active = undefined; });
    return true;
  });
  if (kind === "transcript" && /unofficial\s+transcript/i.test(document.body.innerText)) {
    const button = document.createElement("button");
    button.textContent = "Send to UNTangle";
    button.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;padding:14px 20px;background:#00512b;color:white;border:2px solid white;border-radius:8px;font:600 16px sans-serif;cursor:pointer";
    button.addEventListener("click", () => {
      void chrome.runtime.sendMessage({ type: "send" }).then(status => { button.textContent = status?.waiting ? "Sending to UNTangle…" : "Open UNTangle /connect first"; });
    });
    document.body.append(button);
  }
  void chrome.runtime.sendMessage({ type: "page-ready" });
}
