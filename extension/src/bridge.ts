import { APP_ORIGINS } from "./config";
import { parseMessage, response } from "../../frontend/src/lib/connect/protocol";
if (APP_ORIGINS.includes(location.origin) && location.pathname === "/connect" && window === window.top) {
  const port = chrome.runtime.connect({ name: "untangle-app" });
  const nonces = new Set<string>();
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = parseMessage(event.data);
    if (!message || message.from !== "app") return;
    if (message.type === "cancel") nonces.delete(message.nonce);
    else nonces.add(message.nonce);
    port.postMessage(message);
  });
  port.onMessage.addListener(raw => {
    const message = parseMessage(raw);
    if (!message || message.from !== "extension" || !nonces.has(message.nonce)) return;
    window.postMessage(message, location.origin);
    if (message.type !== "progress") nonces.delete(message.nonce);
  });
  port.onDisconnect.addListener(() => {
    for (const nonce of nonces) window.postMessage(response(nonce, { type: "error", reason: "DISCONNECTED" }), location.origin);
    nonces.clear();
  });
}
