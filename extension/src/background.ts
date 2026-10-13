import { pageKind } from "./config";
import {
  parseMessage,
  response,
  REQUEST_TIMEOUT_MS,
  validPayload,
  type Response,
} from "../../frontend/src/lib/connect/protocol";

type Pending = {
  port: chrome.runtime.Port;
  origin: string;
  nonce: string;
  approvalId: string;
  resource: "transcript" | "sections";
  stage: "approval" | "reading";
  timer: ReturnType<typeof setTimeout>;
  reportTab?: number;
};
let pending: Pending | undefined;

function finish(message?: Response) {
  const current = pending;
  pending = undefined;
  if (!current) return;
  clearTimeout(current.timer);
  if (current.reportTab !== undefined) {
    void chrome.tabs
      .sendMessage(current.reportTab, { type: "cancel", nonce: current.nonce })
      .catch(() => {});
  }
  if (message) current.port.postMessage(message);
}

async function readyTabs(current: Pending) {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(
    (tab) =>
      tab.id !== undefined &&
      tab.url &&
      pageKind(tab.url, __DEV__) === current.resource,
  );
  const probes = await Promise.all(
    candidates.map(async (tab) => {
      try {
        const probe: unknown = await chrome.tabs.sendMessage(tab.id!, {
          type: "probe",
        });
        return probe &&
          typeof probe === "object" &&
          "ready" in probe &&
          probe.ready === true
          ? tab
          : null;
      } catch {
        return null;
      }
    }),
  );
  return probes.filter((tab) => tab !== null);
}

async function approve(approvalId: string) {
  const current = pending;
  if (
    !current ||
    current.approvalId !== approvalId ||
    current.stage !== "approval"
  )
    return false;
  // Consume this one-request approval before discovery awaits. A second click cannot start another read.
  current.stage = "reading";
  const matches = await readyTabs(current);
  if (pending !== current) return false;
  if (matches.length !== 1) {
    finish(
      response(current.nonce, {
        type: "error",
        reason: matches.length > 1 ? "AMBIGUOUS_REPORT" : "NO_REPORT",
      }),
    );
    return false;
  }
  const tab = matches[0];
  if (tab.id === undefined) return false;
  current.reportTab = tab.id;
  current.port.postMessage(
    response(current.nonce, { type: "progress", stage: "reading" }),
  );
  try {
    const raw: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: "read",
      nonce: current.nonce,
      resource: current.resource,
    });
    if (pending !== current) return false;
    // Revalidate the live tab after reading too; a report may navigate while a fetch is in flight.
    const live = await chrome.tabs.get(tab.id);
    if (pending !== current) return false;
    if (!live.url || pageKind(live.url, __DEV__) !== current.resource)
      throw new Error("Report navigated");
    const message = parseMessage(raw);
    if (
      !message ||
      message.from !== "extension" ||
      message.nonce !== current.nonce ||
      (message.type !== "error" && message.type !== "result")
    )
      throw new Error("Invalid report response");
    if (
      message.type === "result" &&
      (!validPayload(message.payload) ||
        (current.resource === "sections") !==
          (message.payload.kind === "sections"))
    )
      throw new Error("Unexpected report resource");
    finish(message);
    return true;
  } catch {
    if (pending === current)
      finish(
        response(current.nonce, {
          type: "error",
          reason: "UNSUPPORTED_REPORT",
        }),
      );
    return false;
  }
}

function receive(port: chrome.runtime.Port, origin: string, raw: unknown) {
  const message = parseMessage(raw);
  if (!message || message.from !== "app") return;
  if (message.type === "hello") {
    port.postMessage(
      response(message.nonce, {
        type: "capabilities",
        resources: ["transcript", "sections"],
      }),
    );
    return;
  }
  if (message.type === "cancel") {
    if (pending?.port === port && pending.nonce === message.nonce) finish();
    return;
  }
  if (pending) {
    port.postMessage(
      response(message.nonce, { type: "error", reason: "BUSY" }),
    );
    return;
  }
  pending = {
    port,
    origin,
    nonce: message.nonce,
    resource: message.resource,
    approvalId: crypto.randomUUID(),
    stage: "approval",
    timer: setTimeout(
      () =>
        finish(response(message.nonce, { type: "error", reason: "TIMEOUT" })),
      REQUEST_TIMEOUT_MS,
    ),
  };
  // App requests only queue work. No report is read until the extension popup approves it.
  port.postMessage(
    response(message.nonce, { type: "progress", stage: "waiting" }),
  );
}

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  if (
    port.name !== "untangle-app" ||
    sender?.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    !sender.url
  ) {
    port.disconnect();
    return;
  }
  const url = new URL(sender.url);
  if (!__APP_ORIGINS__.includes(url.origin) || url.pathname !== "/connect") {
    port.disconnect();
    return;
  }
  port.onMessage.addListener((raw) => receive(port, url.origin, raw));
  port.onDisconnect.addListener(() => {
    if (pending?.port === port) finish();
  });
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !raw ||
    typeof raw !== "object" ||
    !("type" in raw)
  )
    return;
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  if (popup && raw.type === "status") {
    const current = pending;
    void (current ? readyTabs(current) : Promise.resolve([])).then((tabs) => {
      reply(
        pending === current && current
          ? {
              waiting: true,
              origin: current.origin,
              resource: current.resource,
              approvalId: current.approvalId,
              ready: tabs.length === 1,
              reading: current.stage === "reading",
              detail:
                tabs.length > 1
                  ? "Close extra report tabs before approving."
                  : tabs.length === 0
                    ? "Open the report first."
                    : "Report ready. Approve this one import.",
            }
          : { waiting: false },
      );
    });
    return true;
  }
  if (
    popup &&
    raw.type === "approve" &&
    "approvalId" in raw &&
    typeof raw.approvalId === "string"
  ) {
    void approve(raw.approvalId).then((accepted) => reply({ accepted }));
    return true;
  }
  // A page button can open trusted extension UI, but can never approve or release report data.
  if (
    raw.type === "open-approval" &&
    sender.frameId === 0 &&
    sender.url &&
    pageKind(sender.url, __DEV__)
  ) {
    void chrome.action
      .openPopup()
      .then(() => reply({ opened: true }))
      .catch(() => reply({ opened: false }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (pending?.reportTab === tabId)
    finish(response(pending.nonce, { type: "error", reason: "NO_REPORT" }));
});
