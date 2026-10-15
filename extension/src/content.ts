import { ANNOTATION_ATTRIBUTE, buildMarker } from "./content-ui";
import { extractRows } from "./lib/parse-row";
import { isRecord, type SectionRef } from "./shared/extension-api";
// Base64 of frontend/src/app/fonts/dm-sans-latin-opsz-normal.woff2, set by scripts/build.ts.
declare const __DM_SANS_WOFF2__: string;
type Mounted = { key: string; host: HTMLTableRowElement; update: (marker: string) => void };
const mounted = new Map<string, Mounted>();
let fontLoaded = false;
// Shadow roots can't declare fonts, so DM Sans is registered with the page's
// font set from bytes bundled into this script. That fetches nothing and
// needs no web-accessible resource.
function loadFont(): void {
  if (fontLoaded || typeof FontFace !== "function")
    return;
  fontLoaded = true;
  const bytes = Uint8Array.from(atob(__DM_SANS_WOFF2__), char => char.charCodeAt(0));
  const face = new FontFace("DM Sans", bytes, { weight: "100 1000", style: "normal" });
  document.fonts.add(face);
  void face.load().catch(() => { });
}
function requestMarker(ref: SectionRef, update: (marker: string) => void): void {
  void chrome.runtime.sendMessage({ type: "marker/request", ref }).then((reply: unknown) => {
    update(isRecord(reply) && typeof reply.marker === "string" ? reply.marker : "unknown");
  }).catch(() => update("unknown"));
}
/**
 * Adds a marker under each section row that lacks one, and drops markers whose
 * row is gone or now shows another section. With `recheck`, existing markers
 * ask the worker again and update in place, so a changed verdict re-enters
 * instead of the whole strip flashing.
 */
function rescan(recheck = false): void {
  const seen = new Set<string>();
  for (const row of extractRows(document)) {
    seen.add(row.rowId);
    const ref = { term: row.term, classNumber: row.classNumber };
    const key = `${ref.term}:${ref.classNumber}`;
    const anchor = document.getElementById(row.rowId);
    const existing = mounted.get(row.rowId);
    if (existing && existing.key === key && existing.host.isConnected && existing.host.previousElementSibling === anchor) {
      if (recheck)
        requestMarker(ref, existing.update);
      continue;
    }
    existing?.host.remove();
    mounted.delete(row.rowId);
    if (!anchor?.parentElement)
      continue;
    loadFont();
    const marker = buildMarker(row.rowId, () => { void chrome.runtime.sendMessage({ type: "proposal/request", ref }); }, `${row.courseSubject} ${row.courseNumber} section ${row.sectionNumber}`);
    anchor.parentElement.insertBefore(marker.host, anchor.nextSibling);
    mounted.set(row.rowId, { key, host: marker.host, update: marker.update });
    requestMarker(ref, marker.update);
  }
  for (const [rowId, marker] of mounted) {
    if (!seen.has(rowId)) {
      marker.host.remove();
      mounted.delete(rowId);
    }
  }
  // Markers this script didn't mount, such as one left by an earlier copy of it.
  for (const stray of document.querySelectorAll(`[${ANNOTATION_ATTRIBUTE}]`)) {
    if (![...mounted.values()].some(marker => marker.host === stray))
      stray.remove();
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
function start(): void {
  rescan();
  new MutationObserver(() => {
    if (timer)
      clearTimeout(timer);
    timer = setTimeout(() => rescan(), 200);
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else
  start();
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id === chrome.runtime.id && !sender.tab && isRecord(message) && message.type === "markers/refresh")
    rescan(true);
});
window.addEventListener("focus", () => rescan(true));
