"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { WorkflowShell } from "@/components/workflow-shell";
import { usePlanner } from "@/components/planner-provider";
import { courses, prerequisiteEdges } from "@/lib/seed-data";
import {
  courseMap,
  summarizeCompletedCourses,
  summarizeInProgressCourses,
  summarizeNotTakenCourses,
} from "@/lib/planner";
import type { CourseStatus } from "@/lib/types";

function statusLabel(value: CourseStatus) {
  if (value === "completed") return "Done";
  if (value === "inProgress") return "Taking";
  return "Not taken";
}

function statusTone(value: CourseStatus) {
  if (value === "completed") return "green";
  if (value === "inProgress") return "gold";
  return "stone";
}

export function CoursesClient() {
  const { plannerState, setCourseStatus, isRegistered } = usePlanner();
  const [query, setQuery] = useState("");
  const [focusedCourseCode, setFocusedCourseCode] = useState("CSCE 2100");
  const deferredQuery = useDeferredValue(query);
  const courseByCode = useMemo(() => courseMap(), []);

  const groupedCourses = useMemo(() => {
    const normalizedQuery = deferredQuery.toLowerCase().trim();
    return [...courses]
      .filter((course) =>
        normalizedQuery.length === 0
          ? true
          : `${course.code} ${course.title} ${course.department}`.toLowerCase().includes(normalizedQuery),
      )
      .reduce<Record<string, typeof courses>>((groups, course) => {
        groups[course.department] ??= [];
        groups[course.department].push(course);
        return groups;
      }, {});
  }, [deferredQuery]);

  const focusedCourse = courseByCode.get(focusedCourseCode);
  const focusedPrerequisites = prerequisiteEdges.filter((edge) => edge.courseCode === focusedCourseCode);
  const courseGroups = Object.entries(groupedCourses);

  return (
    <WorkflowShell
      step={0}
      eyebrow="Previous Courses"
      title="Mark the courses you have already handled."
      description="This step should feel like a clean academic intake. Search quickly, update statuses in place, and keep prerequisite context present but secondary."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="surface-panel min-w-0 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 border-b border-[color:var(--line)] pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <StatusChip label={`${summarizeCompletedCourses(plannerState)} done`} tone="green" />
              <StatusChip label={`${summarizeInProgressCourses(plannerState)} taking`} tone="gold" />
              <StatusChip label={`${summarizeNotTakenCourses(plannerState)} not taken`} tone="stone" />
            </div>
            <input
              className="field-input max-w-xl"
              placeholder="Search courses, departments, or codes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="mt-6 space-y-7">
            {courseGroups.length === 0 ? (
              <div className="subtle-panel px-5 py-6 text-sm text-[color:var(--copy)]">
                No courses match that search yet. Try a department code or a broader keyword.
              </div>
            ) : (
              courseGroups.map(([department, departmentCourses]) => (
                <section key={department}>
                  <p className="editorial-label mb-3">{department}</p>
                  <div className="space-y-3">
                    {departmentCourses.map((course) => {
                      const status = plannerState.courseStatuses[course.code] ?? "notTaken";
                      const selected = focusedCourseCode === course.code;

                      return (
                        <article
                          key={course.code}
                          className={`subtle-panel px-4 py-4 transition-transform duration-200 ease-out ${
                            selected ? "border-[rgba(53,97,74,0.22)] bg-[rgba(255,255,255,0.98)]" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <button
                              type="button"
                              className="min-w-0 text-left"
                              onClick={() => setFocusedCourseCode(course.code)}
                            >
                              <div className="flex items-center gap-3">
                                <StatusChip label={statusLabel(status)} tone={statusTone(status)} />
                                <div>
                                  <h2 className="text-base font-semibold text-[color:var(--green-900)]">
                                    {course.title}
                                  </h2>
                                  <p className="text-sm text-[color:var(--muted)]">{course.code}</p>
                                </div>
                              </div>
                            </button>

                            <div className="flex flex-wrap gap-2">
                              {([
                                ["notTaken", "Not taken"],
                                ["inProgress", "Taking"],
                                ["completed", "Done"],
                              ] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  className={`rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors duration-150 ${
                                    status === value
                                      ? "border-[color:var(--green-700)] bg-[color:var(--green-800)] text-white"
                                      : "border-[color:var(--line)] bg-[rgba(255,255,255,0.78)] text-[color:var(--muted)] hover:border-[rgba(53,97,74,0.22)] hover:text-[color:var(--green-900)]"
                                  }`}
                                  onClick={() => setCourseStatus(course.code, value)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="surface-panel px-5 py-5">
            <p className="editorial-label">Focused course</p>
            <h2 className="mt-3 font-display text-[2.15rem] font-bold tracking-[-0.06em] text-[color:var(--green-900)]">
              {focusedCourse?.code}
            </h2>
            <p className="mt-2 text-sm leading-7 text-[color:var(--copy)]">{focusedCourse?.description}</p>

            <div className="mt-5 space-y-3">
              {focusedPrerequisites.length === 0 ? (
                <div className="subtle-panel border-dashed px-4 py-4 text-sm text-[color:var(--copy)]">
                  This course can be taken without a prerequisite chain.
                </div>
              ) : (
                focusedPrerequisites.map((edge) => {
                  const prerequisite = courseByCode.get(edge.prerequisiteCode);
                  const prerequisiteStatus = plannerState.courseStatuses[edge.prerequisiteCode] ?? "notTaken";

                  return (
                    <div key={`${edge.courseCode}-${edge.prerequisiteCode}`} className="subtle-panel px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        Requires
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[color:var(--green-900)]">{prerequisite?.title}</p>
                          <p className="text-xs text-[color:var(--muted)]">{prerequisite?.code}</p>
                        </div>
                        <StatusChip label={statusLabel(prerequisiteStatus)} tone={statusTone(prerequisiteStatus)} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="surface-panel px-5 py-5">
            <p className="editorial-label">Persistence</p>
            <p className="mt-3 text-sm leading-7 text-[color:var(--copy)]">
              {isRegistered
                ? "Signed-in changes persist automatically as you move through the planner."
                : "Guest changes stay in this browser session until you close it or sign in later."}
            </p>

            <Link className="primary-button mt-5 w-full" href="/schedule">
              Continue to schedule
            </Link>
          </section>
        </aside>
      </div>
    </WorkflowShell>
  );
}
