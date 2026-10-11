"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusMark } from "@/components/ui/StatusMark";
import type { CourseImportResult } from "@/lib/course-import";
import {
  beginReview,
  computeImportApply,
  emptyImportReviewState,
  ImportReadGuard,
  unresolvedCodes,
  type ImportReviewState,
} from "@/lib/course-import-state";
import type { CourseStatus } from "@/lib/types";

function statusLabel(status: CourseStatus) {
  if (status === "completed") return "Done";
  if (status === "inProgress") return "Taking";
  return "Not taken";
}

const rowStatusOptions: Array<{ value: CourseStatus; label: string }> = [
  { value: "notTaken", label: "Not taken" },
  { value: "inProgress", label: "Taking" },
  { value: "completed", label: "Done" },
];

export function CourseImportPanel({
  courseStatuses,
  setCourseStatus,
  toast,
  plannerReady = true,
}: {
  courseStatuses: Record<string, CourseStatus>;
  setCourseStatus: (code: string, status: CourseStatus) => void;
  toast: (message: string) => void;
  /** False while the planner is still hydrating — apply must wait for it. */
  plannerReady?: boolean;
}) {
  const [review, setReview] = useState<ImportReviewState>(emptyImportReviewState);
  const [requested, setRequested] = useState<Record<string, CourseStatus>>({});
  const [readingFile, setReadingFile] = useState(false);
  const readGuard = useRef(new ImportReadGuard());

  const result: CourseImportResult | null = review.result;
  const unresolved = useMemo(() => unresolvedCodes(result), [result]);
  const changes = useMemo(
    () => computeImportApply(result, requested, courseStatuses),
    [courseStatuses, requested, result],
  );

  function reviewText(text: string) {
    // beginReview keeps the user's text so a failed review stays correctable.
    setReview((current) => beginReview(current, text));
    setRequested({});
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const token = readGuard.current.begin();
    setReadingFile(true);
    try {
      const text = await file.text();
      // A newer import (another file or a paste) supersedes this in-flight read.
      if (readGuard.current.isStale(token)) return;
      readGuard.current.settle();
      reviewText(text);
    } finally {
      if (!readGuard.current.isStale(token)) {
        setReadingFile(false);
      }
    }
  }

  function onImportTextChange(nextText: string) {
    setReview((current) => ({ ...current, text: nextText }));
    // Text typed or pasted after a file read started must never be replaced
    // when that read finishes — cancel the pending read immediately.
    if (readGuard.current.invalidate()) {
      setReadingFile(false);
    }
  }

  function applyImport() {
    if (!plannerReady) {
      toast("Your plan is still loading — try again in a moment");
      return;
    }
    if (changes.length === 0) {
      toast("Imported courses already match the chosen statuses");
      return;
    }
    for (const change of changes) {
      setCourseStatus(change.courseCode, change.status);
    }
    toast(
      `${changes.length} course${changes.length === 1 ? "" : "s"} updated from the import review`,
    );
    setReview((current) => ({ ...current, result: null, error: null }));
    setRequested({});
  }

  const importText = review.text ?? "";

  return (
    <section className="surface-card" style={{ padding: "1rem 1.1rem" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <p className="editorial-label">myUNT import</p>
          <p style={{ marginTop: 4, fontSize: "0.88rem", color: "var(--copy)", maxWidth: 760 }}>
            Paste copied schedule text or upload a saved text, CSV, or HTML file. The bundled
            catalog is the only authority: unknown codes stay unresolved and are never turned into
            courses.
          </p>
        </div>

        <textarea
          className="field-input"
          value={importText}
          onChange={(event) => onImportTextChange(event.target.value)}
          placeholder="Paste schedule text, for example: CSCE3444, MATH 1710, GOVT 2305..."
          rows={4}
          style={{ resize: "vertical", minHeight: 104 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="button"
            onClick={() => reviewText(importText)}
            disabled={importText.trim().length === 0 || readingFile}
          >
            {readingFile ? "Reading file..." : "Review import"}
          </Button>
          <label className="btn-secondary" style={{ cursor: "pointer" }}>
            Upload file
            <input
              type="file"
              accept=".txt,.csv,.html,.htm,text/plain,text/csv,text/html"
              style={{ display: "none" }}
              onChange={(event) => {
                void handleFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {review.error ? (
            <span role="alert" style={{ color: "var(--danger)", fontSize: "0.82rem", fontWeight: 600 }}>
              {review.error}
            </span>
          ) : null}
        </div>

        {result ? (
          <div
            className="animate-content-enter"
            style={{
              display: "grid",
              gap: 10,
              borderTop: "1px solid var(--line)",
              paddingTop: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontWeight: 700, color: "var(--ink)" }}>
                  {result.matched.length} matched, {unresolved.length} unresolved
                  {result.duplicateCodes.length > 0
                    ? `, ${result.duplicateCodes.length} duplicate${result.duplicateCodes.length === 1 ? "" : "s"} ignored`
                    : ""}
                </p>
                <p style={{ marginTop: 2, fontSize: "0.78rem", color: "var(--copy)" }}>
                  Choose a planner status per course, then apply. Only these catalog matches are
                  changed.
                </p>
              </div>
              <Button
                type="button"
                onClick={applyImport}
                disabled={result.matched.length === 0 || !plannerReady}
              >
                {changes.length > 0 ? `Apply ${changes.length} change${changes.length === 1 ? "" : "s"}` : "Nothing to apply"}
              </Button>
            </div>
            {!plannerReady ? (
              <p role="status" style={{ margin: 0, fontSize: "0.8rem", color: "var(--copy)" }}>
                Your plan is still loading — applying unlocks when it finishes.
              </p>
            ) : null}

            {result.matched.map((course) => {
              const currentStatus = courseStatuses[course.code] ?? "notTaken";
              const nextStatus = requested[course.code] ?? "inProgress";
              return (
                <div key={course.code} className="import-row">
                  <div style={{ minWidth: 0 }}>
                    <p className="course-row__title">{course.title}</p>
                    <p className="course-row__meta">{course.code}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <StatusMark label={`Now: ${statusLabel(currentStatus)}`} tone="neutral" />
                    <div role="radiogroup" aria-label={`Planner status for ${course.code}`} style={{ display: "flex", gap: 8 }}>
                      {rowStatusOptions.map((option) => (
                        <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.82rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name={`import-status-${course.code}`}
                            value={option.value}
                            checked={nextStatus === option.value}
                            onChange={() =>
                              setRequested((current) => ({ ...current, [course.code]: option.value }))
                            }
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {unresolved.length > 0 ? (
              <div className="surface-muted" style={{ padding: "0.75rem 0.85rem" }}>
                <p className="editorial-label" style={{ marginBottom: 6 }}>
                  Unresolved — not in the UNTangle catalog
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {unresolved.map((entry) => (
                    <StatusMark
                      key={entry.code}
                      label={`${entry.code}: unresolved`}
                      tone="review"
                    />
                  ))}
                </div>
                <p style={{ color: "var(--copy)", fontSize: "0.8rem", marginTop: 6 }}>
                  These codes are left out of the import. Nothing is fabricated for them — correct
                  the text above and review again.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
