"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusMark } from "@/components/ui/StatusMark";
import { parseCourseImportText, type CourseImportResult } from "@/lib/course-import";
import type { CourseStatus } from "@/lib/types";

function statusLabel(status: CourseStatus) {
  if (status === "completed") return "Done";
  if (status === "inProgress") return "Taking";
  return "Not taken";
}

export function CourseImportPanel({
  courseStatuses,
  setCourseStatus,
  toast,
}: {
  courseStatuses: Record<string, CourseStatus>;
  setCourseStatus: (code: string, status: CourseStatus) => void;
  toast: (message: string) => void;
}) {
  const [importText, setImportText] = useState("");
  const [result, setResult] = useState<CourseImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changes = useMemo(() => {
    if (!result) return [];

    return result.matched.map((course) => ({
      ...course,
      currentStatus: courseStatuses[course.code] ?? "notTaken",
      nextStatus: "inProgress" as const,
    }));
  }, [courseStatuses, result]);

  function reviewText(text: string) {
    const parsed = parseCourseImportText(text);
    setResult(parsed);
    setImportText("");
    setError(parsed.totalCodesFound === 0 ? "No UNT-style course codes were found." : null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;

    const text = await file.text();
    reviewText(text);
  }

  function applyImport() {
    if (!result) return;

    let changed = 0;
    result.matched.forEach((course) => {
      if ((courseStatuses[course.code] ?? "notTaken") !== "inProgress") {
        setCourseStatus(course.code, "inProgress");
        changed += 1;
      }
    });

    toast(
      changed > 0
        ? `${changed} course${changed === 1 ? "" : "s"} marked taking`
        : "Imported courses were already marked taking",
    );
    setResult(null);
  }

  return (
    <section className="surface-card" style={{ padding: "1rem 1.1rem" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <p className="editorial-label">myUNT import</p>
          <p style={{ marginTop: 4, fontSize: "0.88rem", color: "var(--copy)", maxWidth: 760 }}>
            Paste copied schedule text or upload a saved text, CSV, or HTML file. UNTangle only keeps course-code matches.
          </p>
        </div>

        <textarea
          className="field-input"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="Paste schedule text, for example: CSCE3444, MATH 1710, GOVT 2305..."
          rows={4}
          style={{ resize: "vertical", minHeight: 104 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="button"
            onClick={() => reviewText(importText)}
            disabled={importText.trim().length === 0}
          >
            Review import
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
          {error ? (
            <span style={{ color: "var(--danger)", fontSize: "0.82rem", fontWeight: 600 }}>
              {error}
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
                  {result.matched.length} matched, {result.unknownCodes.length} unknown
                </p>
                <p style={{ marginTop: 2, fontSize: "0.78rem", color: "var(--copy)" }}>
                  Duplicates are ignored before review.
                </p>
              </div>
              <Button type="button" onClick={applyImport} disabled={result.matched.length === 0}>
                Apply as taking
              </Button>
            </div>

            {changes.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {changes.map((course) => (
                  <div key={course.code} className="import-row">
                    <div style={{ minWidth: 0 }}>
                      <p className="course-row__title">{course.title}</p>
                      <p className="course-row__meta">{course.code}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <StatusMark label={statusLabel(course.currentStatus)} tone="neutral" />
                      <span style={{ color: "var(--copy)", fontSize: "0.78rem" }}>to</span>
                      <StatusMark label="Taking" tone="in-progress" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {result.unknownCodes.length > 0 ? (
              <div className="surface-muted" style={{ padding: "0.75rem 0.85rem" }}>
                <p className="editorial-label" style={{ marginBottom: 6 }}>
                  Ignored unknown courses
                </p>
                <p style={{ color: "var(--copy)", fontSize: "0.84rem" }}>
                  {result.unknownCodes.join(", ")}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
