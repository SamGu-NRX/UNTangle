import { ANNOTATION_ATTRIBUTE, buildMarker } from "./content-ui";
import { extractRows } from "./lib/parse-row";
import { isRecord } from "./shared/extension-api";
function rescan(): void {
  for (const row of extractRows(document)) {
    if (document.querySelector(`[${ANNOTATION_ATTRIBUTE}="${CSS.escape(row.rowId)}"]`))
      continue;
    const anchor = document.getElementById(row.rowId);
    if (!anchor?.parentElement)
      continue;
    const ref = { term: row.term, classNumber: row.classNumber };
    const marker = buildMarker(row.rowId, () => { void chrome.runtime.sendMessage({ type: "proposal/request", ref }); });
    anchor.parentElement.insertBefore(marker.host, anchor.nextSibling);
    void chrome.runtime.sendMessage({ type: "marker/request", ref }).then((reply: unknown) => {
      if (isRecord(reply) && typeof reply.marker === "string")
        marker.update(reply.marker);
    }).catch(() => marker.update("unknown"));
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
function start(): void {
  rescan();
  new MutationObserver(() => {
    if (timer)
      clearTimeout(timer);
    timer = setTimeout(rescan, 200);
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else
  start();
function refreshMarkers(): void {
  for (const marker of document.querySelectorAll(`[${ANNOTATION_ATTRIBUTE}]`))
    marker.remove();
  rescan();
}
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id === chrome.runtime.id && !sender.tab && isRecord(message) && message.type === "markers/refresh")
    refreshMarkers();
});
window.addEventListener("focus", refreshMarkers);
