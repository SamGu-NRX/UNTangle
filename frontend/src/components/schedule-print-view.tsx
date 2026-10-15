"use client";

import Link from "next/link";
import { usePlanner } from "@/components/planner-provider";
import { PlannerSampleNotice } from "@/components/planner-sample-notice";
import { formatTime, summarizeCredits } from "@/lib/planner";
import { rangeLabel } from "@/lib/planner-sections";
import { classDays, weekDays, type ClassDay } from "@/lib/types";

const DAY_NAMES: Record<ClassDay, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

// Scoped print rules: hide the controls and the toast stack, keep each day
// together on paper, print in black on white.
const PRINT_CSS = `
@media print {
  .print-controls, .toast-stack { display: none !important; }
  .print-sheet { padding: 0 !important; max-width: none !important; }
  .print-day { break-inside: avoid; }
  body { background: #fff !important; color: #000 !important; }
}
`;

/** One-page week of the working schedule, for printing. */
export function SchedulePrintView() {
  const { hydrated, plannerState, scheduleEvents } = usePlanner();
  const days = classDays.filter((day) => (weekDays as readonly ClassDay[]).includes(day) || scheduleEvents.some((event) => event.day === day));
  const sample = scheduleEvents.some((event) => event.provenance === "sample");

  return (
    <main className="print-sheet" style={{ maxWidth: 820, margin: "0 auto", padding: "1.5rem 1.25rem", display: "grid", gap: 16 }}>
      <style>{PRINT_CSS}</style>
      <div className="print-controls" style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <Link href="/schedule" className="btn-ghost">
          Back to schedule
        </Link>
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!hydrated}>
          Print
        </button>
      </div>

      <header>
        <h1 className="font-display" style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--brand-900)" }}>
          Weekly schedule
        </h1>
        <p style={{ color: "var(--copy)", fontSize: "0.9rem" }}>
          {hydrated
            ? `${scheduleEvents.length} meetings a week, ${summarizeCredits(plannerState)} credit hours`
            : "Loading your schedule…"}
        </p>
      </header>

      <PlannerSampleNotice compact />

      {hydrated && scheduleEvents.length === 0 ? (
        <p style={{ color: "var(--copy)" }}>No classes yet. Mark courses as Taking, then come back to print.</p>
      ) : null}

      {hydrated
        ? days.map((day) => {
            const dayEvents = scheduleEvents
              .filter((event) => event.day === day)
              .sort((a, b) => a.start.localeCompare(b.start));
            return (
              <section key={day} className="print-day" aria-labelledby={`print-${day}`}>
                <h2 id={`print-${day}`} style={{ fontSize: "1rem", fontWeight: 700, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>
                  {DAY_NAMES[day]}
                </h2>
                {dayEvents.length === 0 ? (
                  <p style={{ color: "var(--copy)", fontSize: "0.86rem", marginTop: 6 }}>No classes</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", marginTop: 4 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--copy)" }}>
                        <th scope="col" style={{ padding: "4px 8px 4px 0", fontWeight: 600 }}>Time{sample ? " (sample)" : ""}</th>
                        <th scope="col" style={{ padding: "4px 8px", fontWeight: 600 }}>Course</th>
                        <th scope="col" style={{ padding: "4px 8px", fontWeight: 600 }}>Room</th>
                        <th scope="col" style={{ padding: "4px 0 4px 8px", fontWeight: 600 }}>Instructor{sample ? " (sample)" : ""}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayEvents.map((event) => (
                        <tr key={`${event.sectionId}-${event.start}`} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                            {formatTime(event.start)}–{formatTime(event.end)}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <strong>{event.courseCode}</strong> {event.title}
                            <span style={{ color: "var(--copy)" }}>
                              {" "}
, section {event.sectionLabel}
                              {event.provenance === "sample" ? " (sample)" : ""}
                              {rangeLabel(event.dates) ? `, ${rangeLabel(event.dates)}` : ""}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>{event.location}</td>
                          <td style={{ padding: "6px 0 6px 8px" }}>{event.professor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })
        : null}
    </main>
  );
}
