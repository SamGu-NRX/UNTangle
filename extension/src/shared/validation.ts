import { isClassSearchUrl } from "../config";
import { isId, isRecord, isSectionRef, type SectionRef } from "./extension-api";
export type PageRequest = {
  type: "marker/request" | "proposal/request";
  ref: SectionRef;
};
export type PanelRequest = {
  type: "panel/status" | "panel/sign-in" | "panel/retry" | "panel/sign-out";
} | {
  type: "panel/confirm";
  previewId: string;
};
export type Request = PageRequest | PanelRequest;
export function validateMessage(raw: unknown, sender: chrome.runtime.MessageSender, extensionId: string): Request | null {
  if (!isRecord(raw) || typeof raw.type !== "string" || sender.id !== extensionId)
    return null;
  if (raw.type === "marker/request" || raw.type === "proposal/request") {
    if (Object.keys(raw).length !== 2 || !isSectionRef(raw.ref) || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId) || (sender.frameId ?? -1) < 0 || !isClassSearchUrl(sender.tab?.url) || !isClassSearchUrl(sender.url))
      return null;
    if (sender.origin && sender.origin !== new URL(sender.url!).origin)
      return null;
    return { type: raw.type, ref: raw.ref };
  }
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  if (sender.url !== popupUrl || (sender.tab && (sender.tab.url !== popupUrl || sender.frameId !== 0)))
    return null;
  if ((raw.type === "panel/status" || raw.type === "panel/sign-in" || raw.type === "panel/retry" || raw.type === "panel/sign-out") && Object.keys(raw).length === 1)
    return { type: raw.type };
  if (raw.type === "panel/confirm" && Object.keys(raw).length === 2 && isId(raw.previewId))
    return { type: raw.type, previewId: raw.previewId };
  return null;
}
