"use client";

import { useState } from "react";
import { usePlanner, useToast } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { StatusMark } from "@/components/ui/StatusMark";
import { getMissingPrerequisites } from "@/lib/planner";
import { sections as bundledSections } from "@/lib/seed-data";
import type { CourseStatus } from "@/lib/types";

/**
 * Plan-choice controls for the course detail page.
 *
 * Reuses the planner provider's public actions (`setCourseStatus`,
 * `setSection`) — no second planner store, no new status rules.
 *
 * Two safeguards:
 * - Every write is gated on the planner's hydration. The planner restores
 *   saved state after the auth session resolves; writing before that would
 *   clobber the restored plan, so choices stay disabled until it finishes.
 * - The catalog row's prerequisite-lock policy is enforced here too: while a
 *   course's prerequisites are unmet and it is not Done, it cannot be marked
 *   Taking/Done and its section cannot be added to the working schedule.
 */

const statusOptions: Array<{ value: CourseStatus; label: string }> = [
  { value: "notTaken", label: "Not taken" },
  { value: "inProgress", label: "Taking" },
  { value: "completed", label: "Done" },
];

function statusLabel(status: CourseStatus): string {
  return statusOptions.find((option) => option.value === status)?.label ?? "Not taken";
}

/** "csce-2100-002" → "002" — the section number the journeys use. */
function sectionNumber(sectionId: string): string {
  return sectionId.split("-").pop() ?? sectionId;
}

export function CoursePlanActions({ courseCode }: { courseCode: string }) {
  const { hydrated, plannerState, setCourseStatus, setSection, isLocked } = usePlanner();
  const { toast } = useToast();
  const [chosenSectionId, setChosenSectionId] = useState<string | null>(null);

  const currentStatus = plannerState.courseStatuses[courseCode] ?? "notTaken";
  const completed = currentStatus === "completed";
  const courseSections = bundledSections.filter((section) => section.courseCode === courseCode);
  const selectedSectionId = plannerState.selectedSections[courseCode];
  const locked = isLocked(courseCode);
  const lockActive = locked && !completed;
  const missing = getMissingPrerequisites(
    courseCode,
    plannerState.courseStatuses,
    plannerState.transcriptRecords,
  );
  const planReady = hydrated && !lockActive;

  // The radio choice is local until "Add" is pressed; when the user has not
  // chosen yet, the radios follow the planner's current selection.
  const effectiveChoice = chosenSectionId ?? selectedSectionId ?? "";
  const chosenSection = courseSections.find((section) => section.id === effectiveChoice) ?? null;
  const chosenIsPlanned = Boolean(chosenSection && selectedSectionId === chosenSection.id);

  function addChosenSection() {
    if (!planReady || !chosenSection) return;
    setSection(courseCode, chosenSection.id);
    toast(`${courseCode} section ${sectionNumber(chosenSection.id)} added to your working schedule`);
  }

  function removeSection() {
    if (!planReady) return;
    setSection(courseCode, "");
    toast(`${courseCode} section removed from your working schedule`);
  }

  return (
    <section className="detail-section" aria-label={`Planner actions for ${courseCode}`}>
      <div className="detail-section__head">
        <h2>Plan this course</h2>
        <StatusMark
          label={`Planner status: ${hydrated ? statusLabel(currentStatus) : "loading…"}`}
          tone={currentStatus === "completed" ? "completed" : currentStatus === "inProgress" ? "in-progress" : "neutral"}
        />
      </div>
      {hydrated ? (
        <p style={{ color: "var(--muted)", margin: "0 0 0.75rem" }}>
          Your choice syncs with the schedule optimizer and degree plan.
        </p>
      ) : (
        <p role="status" style={{ color: "var(--muted)", margin: "0 0 0.75rem" }}>
          Loading your plan — planner choices unlock when it finishes loading.
        </p>
      )}
      <div
        role="group"
        aria-label={`Planner status for ${courseCode}`}
        aria-busy={!hydrated}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
      >
        {statusOptions.map((option) => {
          const active = currentStatus === option.value;
          const lockBlocked = lockActive && option.value !== "notTaken";
          return (
            <Button
              key={option.value}
              variant={active ? "primary" : "secondary"}
              aria-pressed={active}
              disabled={!hydrated || lockBlocked}
              onClick={() => setCourseStatus(courseCode, option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {lockActive ? (
        <div className="course-row__lock" style={{ marginTop: "0.75rem" }}>
          🔒 Requires: {missing.join(", ")}
        </div>
      ) : null}

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
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--copy)" }}>
            These are sample sections from the bundled catalog — not a real term&apos;s offerings.
          </p>
          <div
            role="radiogroup"
            aria-label={`Section choice for ${courseCode}`}
            aria-busy={!hydrated}
            style={{ display: "grid", gap: "0.4rem" }}
          >
            {courseSections.map((section) => {
              const active = effectiveChoice === section.id;
              return (
                <label
                  key={section.id}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: planReady ? "pointer" : "default" }}
                >
                  <input
                    type="radio"
                    name={`plan-section-${courseCode}`}
                    value={section.id}
                    checked={active}
                    disabled={!hydrated}
                    onChange={() => setChosenSectionId(section.id)}
                  />
                  <span>
                    <strong>{section.title}</strong> · {section.professor} · Section{" "}
                    {sectionNumber(section.id)}
                  </span>
                </label>
              );
            })}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: planReady ? "pointer" : "default" }}>
              <input
                type="radio"
                name={`plan-section-${courseCode}`}
                value=""
                checked={effectiveChoice === ""}
                disabled={!hydrated}
                onChange={() => setChosenSectionId("")}
              />
              <span>No section yet</span>
            </label>
          </div>
          {chosenSection ? (
            chosenIsPlanned ? (
              <p role="status" style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.6rem 0 0" }}>
                Section {sectionNumber(chosenSection.id)} is in your working schedule.
              </p>
            ) : (
              <Button
                type="button"
                onClick={addChosenSection}
                disabled={!planReady}
                style={{ marginTop: "0.6rem" }}
              >
                Add {courseCode} section {sectionNumber(chosenSection.id)}
              </Button>
            )
          ) : selectedSectionId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={removeSection}
              disabled={!planReady}
              style={{ marginTop: "0.6rem" }}
            >
              Remove {courseCode} section from schedule
            </Button>
          ) : null}
        </fieldset>
      )}
    </section>
  );
}
