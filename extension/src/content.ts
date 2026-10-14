/**
 * The content script. Parses visible results rows, asks the service worker
 * for facts, renders the annotation rows, and watches for PeopleSoft
 * re-renders. It sends no fetches of its own and stays dormant on pages
 * without a results grid - including the mock's transcript page.
 */
import { applyAdd, applyFacts, applyFactsError, ANNOTATION_ATTRIBUTE, buildAnnotationRow } from "./content-ui";
import { extractRows } from "./lib/parse-row";
import type { ParsedSectionRow, WorkerResponse } from "./shared/messages";

const RESCAN_DEBOUNCE_MS = 200;

function send(message: { type: "facts/request" | "add/request"; row: ParsedSectionRow }): Promise<WorkerResponse | undefined> {
  return chrome.runtime.sendMessage(message) as Promise<WorkerResponse | undefined>;
}

/** Asks the worker for facts and renders them, or an honest retryable error. */
function requestFacts(row: ParsedSectionRow, annotation: HTMLTableRowElement, fail: () => void): void {
  void send({ type: "facts/request", row })
    .then(response => {
      if (response === undefined || response.type !== "facts/result" || response.rowId !== row.rowId) {
        fail();
        return;
      }
      applyFacts(annotation, response.conflict, response.grades);
    })
    .catch(fail);
}

/** Rebuilds every annotation except the given row's own, whose state the student just set. */
function refreshOtherRows(rowId: string): void {
  for (const annotation of document.querySelectorAll(`[${ANNOTATION_ATTRIBUTE}]`)) {
    if (annotation.getAttribute(ANNOTATION_ATTRIBUTE) === rowId) continue;
    annotation.remove();
  }
  rescan();
}

/** One annotation row per section row; rows already annotated are left alone. */
function annotate(rows: ParsedSectionRow[]): void {
  for (const row of rows) {
    if (document.querySelector(`[${ANNOTATION_ATTRIBUTE}="${CSS.escape(row.rowId)}"]`)) continue;
    const anchor = document.getElementById(row.rowId);
    if (!anchor || !anchor.parentElement) continue;
    const annotation = buildAnnotationRow(row);
    anchor.parentElement.insertBefore(annotation, anchor.nextSibling);

    const fail = () => applyFactsError(annotation, () => requestFacts(row, annotation, fail));
    requestFacts(row, annotation, fail);

    const button = annotation.querySelector<HTMLButtonElement>("button[data-unt-add]");
    button?.addEventListener("click", event => {
      // A page script can call click() on this shared button; only a real
      // user click may submit a planner write with the student's session.
      if (!event.isTrusted) return;
      button.disabled = true;
      void send({ type: "add/request", row })
        .then(response => {
          // No answer is not a success: restore the retryable failed state.
          if (response === undefined || response.type !== "add/result" || response.rowId !== row.rowId) {
            applyAdd(annotation, "failed");
            return;
          }
          applyAdd(annotation, response.outcome);
          // The schedule changed: every other row's badge is now stale.
          if (response.outcome === "added") refreshOtherRows(row.rowId);
        })
        .catch(() => {
          applyAdd(annotation, "failed");
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
