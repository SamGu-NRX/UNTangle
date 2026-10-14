/**
 * The popup: UNTangle session state (derived from the planner GET outcome by
 * the service worker), the configured origin, and a link to the app. No
 * credential forms and no token storage - the extension never handles
 * credentials.
 */
import type { StatusResult } from "./shared/messages";

const COPY: Record<StatusResult["session"], { text: string; className: string }> = {
  "signed-in": { text: "Signed in to UNTangle", className: "signed-in" },
  "signed-out": { text: "Signed out of UNTangle", className: "signed-out" },
  unreachable: { text: "Cannot reach UNTangle", className: "unreachable" },
};

async function main(): Promise<void> {
  const sessionElement = document.getElementById("session");
  const originElement = document.getElementById("origin");
  const link = document.getElementById("open-untangle");
  if (!sessionElement || !originElement || !link) return;

  try {
    const response = (await chrome.runtime.sendMessage({ type: "status/request" })) as StatusResult | undefined;
    if (!response || response.type !== "status/result") throw new Error("no status response");
    const copy = COPY[response.session];
    sessionElement.textContent = `${copy.text} - facts apply to the ${response.schedule} schedule`;
    sessionElement.className = copy.className;
    originElement.textContent = response.origin;
    link.setAttribute("href", response.origin);
  } catch {
    sessionElement.textContent = "Cannot reach the UNTangle worker";
    sessionElement.className = "unreachable";
  }
}

void main();
