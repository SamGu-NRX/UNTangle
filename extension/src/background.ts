import { DeviceClient } from "./lib/device-client";
import type { DeviceAuth } from "./lib/worker-controller";
import type { LocalStore } from "./lib/outbox";
import { PlannerClient } from "./lib/planner-client";
import { WorkerController } from "./lib/worker-controller";
import { validateMessage } from "./shared/validation";
const store: LocalStore = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: async (key, value) => { await chrome.storage.local.set({ [key]: value }); },
  remove: async (key) => { await chrome.storage.local.remove(key); },
  all: () => chrome.storage.local.get(null),
};
// A connected port means a trusted panel is open. When the panel closes, its
// port disconnects and the sign-in poll stops with it.
const panelPorts = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "panel")
    return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});
const devices = new DeviceClient(fetch.bind(globalThis), {
  // The approval page opens as a normal browser tab, never a content script
  // and never an identity window: the student signs in where UNTangle lives.
  openTab: url => { void chrome.tabs.create({ url }); },
  panelOpen: () => panelPorts.size > 0,
});
const auth: DeviceAuth = {
  signIn: input => devices.signIn(input),
  refresh: refreshToken => devices.refresh(refreshToken),
  revoke: accessToken => devices.revoke(accessToken),
};
async function refreshMarkers(): Promise<void> {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined)
      await chrome.tabs.sendMessage(tab.id, { type: "markers/refresh" }).catch(() => { });
  }
}
const controller = new WorkerController(store, new PlannerClient(fetch.bind(globalThis)), auth, refreshMarkers);
const ready = (async () => {
  // Local storage is exposed to content scripts unless this is set. The stored
  // token pair stays visible to trusted extension contexts only.
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await controller.start();
})();
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  const request = validateMessage(raw, sender, chrome.runtime.id);
  if (!request) {
    respond({ error: "Message rejected" });
    return false;
  }
  const handled = ready.then(() => controller.handle(request));
  void handled.then(respond, () => respond({ error: "UNTangle couldn't load. Retry." }));
  // A marker click proposes the section, then opens the trusted panel, which
  // reviews it and holds the only Add button. The panel opens after the
  // proposal is stored so its first status read finds it. Chrome refuses
  // openPopup when the window isn't focused; the toolbar button then opens
  // the same review.
  if (request.type === "proposal/request")
    void handled.then(() => chrome.action.openPopup({ windowId: sender.tab?.windowId })).catch(() => { });
  return true;
});
