/**
 * DOM rendering for the facts the service worker returns: one annotation row
 * per section row carrying the Main-schedule conflict badge, the instructor
 * grade panel, and the Add button. Every state - pending, unknown,
 * unavailable, no match, failed - renders as its own honest copy.
 */
import type { AddOutcome, ConflictVerdict, GradesVerdict, ParsedSectionRow } from "./shared/messages";
import { SCHEDULE_NAME } from "./config";

export const ANNOTATION_ATTRIBUTE = "data-unt-row";
export const BADGE_ATTRIBUTE = "data-unt-badge";
export const GRADES_ATTRIBUTE = "data-unt-grades";
export const ADD_ATTRIBUTE = "data-unt-add";

function text(tag: string, value: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function minutesLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const meridiem = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

export function conflictCopy(verdict: ConflictVerdict): { state: string; label: string; detail: string | null } {
  switch (verdict.kind) {
    case "conflict": {
      const first = verdict.hits[0];
      const detail =
        first === undefined
          ? null
          : `${first.courseCode} ${first.day} ${minutesLabel(first.startMinutes)} - ${minutesLabel(first.endMinutes)}`;
      return { state: "conflict", label: `Conflicts with ${SCHEDULE_NAME}`, detail };
    }
    case "clear":
      return { state: "clear", label: `No conflict with ${SCHEDULE_NAME}`, detail: null };
    case "unknown": {
      const reason =
        verdict.reason === "row-time-missing"
          ? `this row has no meeting times to check against ${SCHEDULE_NAME}`
          : verdict.reason === "schedule-time-missing"
            ? `a ${SCHEDULE_NAME} section has no meeting times to compare`
            : `${SCHEDULE_NAME} is unavailable right now`;
      return { state: "unknown", label: `Cannot check against ${SCHEDULE_NAME}`, detail: reason };
    }
  }
}

export function gradesCopy(verdict: GradesVerdict): { state: string; label: string; detail: string | null } {
  switch (verdict.kind) {
    case "history": {
      const letters = Object.entries(verdict.counts)
        .filter(([, count]) => count > 0)
        .map(([letter, count]) => `${letter} ${Math.round((count / verdict.total) * 100)}%`)
        .join(", ");
      const gpa = verdict.gpa === null ? null : `GPA ${verdict.gpa.toFixed(2)}`;
      const detail = [gpa, `${verdict.total} grades`, letters || null].filter(part => part !== null).join(" - ");
      return { state: "history", label: `Grade history - ${verdict.instructorName} - ${verdict.courseCode}`, detail };
    }
    case "no-history":
      return {
        state: "no-history",
        label: "No grade history",
        detail: verdict.detail === "no-course-history" ? "for this course" : "for this instructor",
      };
    case "no-match":
      return { state: "no-match", label: "No confident instructor match", detail: verdict.reason };
    case "unavailable":
      return {
        state: "unavailable",
        label: "Grade history unavailable",
        detail:
          verdict.retryAfterSeconds === undefined
            ? verdict.message
            : `${verdict.message} Try again in ${verdict.retryAfterSeconds}s.`,
      };
  }
}

const ADD_COPY: Record<AddOutcome, { state: string; label: string }> = {
  added: { state: "added", label: `Added to ${SCHEDULE_NAME}` },
  "already-scheduled": { state: "already-scheduled", label: `Already in ${SCHEDULE_NAME}` },
  "conflict-write": { state: "conflict-write", label: `${SCHEDULE_NAME} changed during the add; try again` },
  "signed-out": { state: "signed-out", label: "Sign in to UNTangle to add" },
  "not-found": { state: "not-found", label: "Class number not in this term" },
  failed: { state: "failed", label: "Could not add; try again" },
};

/** Builds the annotation row for one parsed section row. DOM-facing, thin. */
export function buildAnnotationRow(row: ParsedSectionRow): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.setAttribute(ANNOTATION_ATTRIBUTE, row.rowId);
  const cell = document.createElement("td");
  cell.colSpan = 8;

  const conflict = conflictCopy({
    kind: "unknown",
    reason: "schedule-unavailable",
  } satisfies ConflictVerdict);
  const badge = text("span", conflict.label, "unt-badge");
  badge.setAttribute(BADGE_ATTRIBUTE, conflict.state);
  badge.title = conflict.detail ?? "";
  cell.appendChild(badge);

  const grades = text("span", "Grade history: checking", "unt-grades");
  grades.setAttribute(GRADES_ATTRIBUTE, "pending");
  cell.appendChild(grades);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "unt-add";
  add.textContent = `Add to ${SCHEDULE_NAME}`;
  add.setAttribute(ADD_ATTRIBUTE, "idle");
  cell.appendChild(add);

  tr.appendChild(cell);
  return tr;
}

/** Applies a facts result to the row's annotation. DOM-facing, thin. */
export function applyFacts(annotation: HTMLTableRowElement, conflict: ConflictVerdict, grades: GradesVerdict): void {
  const badge = annotation.querySelector<HTMLElement>(`[${BADGE_ATTRIBUTE}]`);
  if (badge) {
    const copy = conflictCopy(conflict);
    badge.setAttribute(BADGE_ATTRIBUTE, copy.state);
    badge.textContent = copy.detail === null ? copy.label : `${copy.label} - ${copy.detail}`;
    badge.title = copy.detail ?? "";
  }
  const gradesElement = annotation.querySelector<HTMLElement>(`[${GRADES_ATTRIBUTE}]`);
  if (gradesElement) {
    const copy = gradesCopy(grades);
    gradesElement.setAttribute(GRADES_ATTRIBUTE, copy.state);
    gradesElement.textContent = copy.detail === null ? copy.label : `${copy.label} - ${copy.detail}`;
  }
}

/** Applies an add result to the row's annotation. DOM-facing, thin. */
export function applyAdd(annotation: HTMLTableRowElement, outcome: AddOutcome): void {
  const button = annotation.querySelector<HTMLButtonElement>(`[${ADD_ATTRIBUTE}]`);
  if (!button) return;
  const copy = ADD_COPY[outcome];
  button.setAttribute(ADD_ATTRIBUTE, copy.state);
  button.textContent = copy.label;
  button.disabled = outcome === "added" || outcome === "already-scheduled";
}
