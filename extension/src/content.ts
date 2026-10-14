/**
 * The content script. Parses visible results rows, asks the service worker
 * for facts, renders the annotation rows, and watches for PeopleSoft
 * re-renders. It sends no fetches of its own and stays dormant on pages
 * without a results grid - including the mock's transcript page.
 */
import { applyAdd, applyFacts, ANNOTATION_ATTRIBUTE, buildAnnotationRow } from "./content-ui";
import { extractRows } from "./lib/parse-row";
import type { ParsedSectionRow, WorkerResponse } from "./shared/messages";

const RESCAN_DEBOUNCE_MS = 200;

function send(message: { type: "facts/request" | "add/request"; row: ParsedSectionRow }): Promise<WorkerResponse | undefined> {
  return chrome.runtime.sendMessage(message) as Promise<WorkerResponse | undefined>;
}

/** One annotation row per section row; rows already annotated are left alone. */
function annotate(rows: ParsedSectionRow[]): void {
  for (const row of rows) {
    if (document.querySelector(`[${ANNOTATION_ATTRIBUTE}="${CSS.escape(row.rowId)}"]`)) continue;
    const anchor = document.getElementById(row.rowId);
    if (!anchor || !anchor.parentElement) continue;
    const annotation = buildAnnotationRow(row);
    anchor.parentElement.insertBefore(annotation, anchor.nextSibling);

    void send({ type: "facts/request", row })
      .then(response => {
        if (response === undefined || response.type !== "facts/result" || response.rowId !== row.rowId) return;
        applyFacts(annotation, response.conflict, response.grades);
      })
      .catch(() => {
        // A sleeping worker or a closed port leaves the pending copy visible;
        // the next rescan re-requests rather than rendering a fake verdict.
      });

    const button = annotation.querySelector<HTMLButtonElement>("button[data-unt-add]");
    button?.addEventListener("click", () => {
      button.disabled = true;
      void send({ type: "add/request", row })
        .then(response => {
          if (response === undefined || response.type !== "add/result" || response.rowId !== row.rowId) return;
          applyAdd(annotation, response.outcome);
        })
        .catch(() => {
          // Same rule as above: keep the button visible, retry on rescan.
        });
    });
  }
}

function rescan(): void {
  annotate(extractRows(document));
}

let rescanTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRescan(): void {
  if (rescanTimer !== undefined) clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    rescanTimer = undefined;
    rescan();
  }, RESCAN_DEBOUNCE_MS);
}

function start(): void {
  rescan();
  // PeopleSoft re-renders the results grid in place; annotations must follow.
  new MutationObserver(scheduleRescan).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
