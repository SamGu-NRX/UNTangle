import { APP_ORIGINS } from "./config";
import { parseMessage, response } from "../../frontend/src/lib/connect/protocol";
if (APP_ORIGINS.includes(location.origin) && window === window.top) {
  let port: chrome.runtime.Port | undefined;
  const nonces = new Set<string>();
  const onConnectRoute = () => location.pathname === "/connect";
  function disconnect() { const old = port; port = undefined; nonces.clear(); old?.disconnect(); }
  function connect() {
    const created = chrome.runtime.connect({ name: "untangle-app" });
    port = created;
    created.onMessage.addListener(raw => {
      if (!onConnectRoute()) { disconnect(); return; }
      const message = parseMessage(raw);
      if (!message || message.from !== "extension" || !nonces.has(message.nonce)) return;
      window.postMessage(message, location.origin);
      if (message.type !== "progress") nonces.delete(message.nonce);
    });
    created.onDisconnect.addListener(() => {
      if (port !== created) return;
      port = undefined;
      if (onConnectRoute()) for (const nonce of nonces) window.postMessage(response(nonce, { type: "error", reason: "DISCONNECTED" }), location.origin);
      nonces.clear();
    });
    return created;
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!onConnectRoute()) { disconnect(); return; }
    const message = parseMessage(event.data);
    if (!message || message.from !== "app") return;
    if (message.type === "cancel") nonces.delete(message.nonce);
    else nonces.add(message.nonce);
    (port ?? connect()).postMessage(message);
  });
  // Next.js navigation can retain this document and isolated script. Revoke the port when the route leaves Connect.
  setInterval(() => { if (port && !onConnectRoute()) disconnect(); }, 500);
  window.addEventListener("pagehide", disconnect);
}
