import { DeviceClient } from "./lib/device-client";
import type { LocalStore } from "./lib/outbox";
import { PlannerClient } from "./lib/planner-client";
import { WorkerController } from "./lib/worker-controller";
import { StudentError } from "./shared/student-error";
import { validateMessage } from "./shared/validation";
const store: LocalStore = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: async (key, value) => { await chrome.storage.local.set({ [key]: value }); },
  remove: async (key) => { await chrome.storage.local.remove(key); },
  all: () => chrome.storage.local.get(null),
};
const devices = new DeviceClient(fetch.bind(globalThis), {
  redirectUri: chrome.identity.getRedirectURL("device"),
  launch: async (url) => {
    const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    if (!result)
      throw new StudentError("The sign-in window closed before you finished. Sign in again.");
    return result;
  },
});
async function refreshMarkers(): Promise<void> {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined)
      await chrome.tabs.sendMessage(tab.id, { type: "markers/refresh" }).catch(() => { });
  }
}
const controller = new WorkerController(store, new PlannerClient(fetch.bind(globalThis)), devices, refreshMarkers);
const ready = (async () => {
  // Local storage is exposed to content scripts unless this is set.
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
