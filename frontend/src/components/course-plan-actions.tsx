"use client";

import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { StatusMark } from "@/components/ui/StatusMark";
import { sections as bundledSections } from "@/lib/seed-data";
import type { CourseStatus } from "@/lib/types";

/**
 * Plan-choice controls for the course detail page.
 *
 * Reuses the planner provider's public actions (`setCourseStatus`,
 * `setSection`) — no second planner store, no new status rules.
 */

const statusOptions: Array<{ value: CourseStatus; label: string }> = [
  { value: "notTaken", label: "Not taken" },
  { value: "inProgress", label: "Taking" },
  { value: "completed", label: "Done" },
];

function statusLabel(status: CourseStatus): string {
  return statusOptions.find((option) => option.value === status)?.label ?? "Not taken";
}

export function CoursePlanActions({ courseCode }: { courseCode: string }) {
  const { plannerState, setCourseStatus, setSection } = usePlanner();
  const currentStatus = plannerState.courseStatuses[courseCode] ?? "notTaken";
  const courseSections = bundledSections.filter((section) => section.courseCode === courseCode);
  const selectedSectionId = plannerState.selectedSections[courseCode];

  return (
    <section className="detail-section" aria-label={`Planner actions for ${courseCode}`}>
      <div className="detail-section__head">
        <h2>Plan this course</h2>
        <StatusMark
          label={`Planner status: ${statusLabel(currentStatus)}`}
          tone={currentStatus === "completed" ? "completed" : currentStatus === "inProgress" ? "in-progress" : "neutral"}
        />
      </div>
      <p style={{ color: "var(--muted)", margin: "0 0 0.75rem" }}>
        Your choice syncs with the schedule optimizer and degree plan.
      </p>
      <div role="group" aria-label={`Planner status for ${courseCode}`} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {statusOptions.map((option) => {
          const active = currentStatus === option.value;
          return (
            <Button
              key={option.value}
              variant={active ? "primary" : "secondary"}
              aria-pressed={active}
              onClick={() => setCourseStatus(courseCode, option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {courseSections.length > 0 && (
        <fieldset
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "0.75rem 1rem",
            margin: "1rem 0 0",
          }}
        >
          <legend style={{ fontSize: "0.85rem", color: "var(--muted)", padding: "0 0.35rem" }}>
            Bundled section options
          </legend>
          <div role="radiogroup" aria-label={`Section choice for ${courseCode}`} style={{ display: "grid", gap: "0.4rem" }}>
            {courseSections.map((section) => {
              const active = selectedSectionId === section.id;
              return (
                <label key={section.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={`plan-section-${courseCode}`}
                    value={section.id}
                    checked={active}
                    onChange={() => setSection(courseCode, section.id)}
                  />
                  <span>
                    <strong>{section.title}</strong> · {section.professor}
                  </span>
                </label>
              );
            })}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="radio"
                name={`plan-section-${courseCode}`}
                value=""
                checked={!selectedSectionId}
                onChange={() => setSection(courseCode, "")}
              />
              <span>No section yet</span>
            </label>
          </div>
        </fieldset>
      )}
    </section>
  );
}
