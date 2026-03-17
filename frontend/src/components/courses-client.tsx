"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
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
          : `${course.code} ${course.title} ${course.department}`
              .toLowerCase()
              .includes(normalizedQuery),
      )
      .reduce<Record<string, typeof courses>>((groups, course) => {
        groups[course.department] ??= [];
        groups[course.department].push(course);
        return groups;
      }, {});
  }, [deferredQuery]);

  const focusedCourse = courseByCode.get(focusedCourseCode);
  const focusedPrerequisites = prerequisiteEdges.filter(
    (edge) => edge.courseCode === focusedCourseCode,
  );

  return (
    <AppShell
      currentStep={1}
      eyebrow="Previous Courses"
      title="Mark what you have already finished."
      subtitle="This step keeps the original prototype’s course-status workflow, but adds clearer counts, faster scanning, and lightweight prerequisite context so the screen feels more useful than a long checkbox list."
      aside={
        <div className="space-y-4">
          <div className="glass-panel p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Live status
            </p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-white/70 p-4">
                <p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">
                  Persistence
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--copy)]">
                  {isRegistered
                    ? "Signed-in changes will persist as the working planner state."
                    : "Guest mode keeps this state for the current browser session only."}
                </p>
              </div>
              <div className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-white/70 p-4">
                <p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">
                  Selected focus
                </p>
                <p className="mt-2 font-display text-2xl font-bold tracking-[-0.04em] text-[var(--green-900)]">
                  {focusedCourse?.code}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--copy)]">
                  {focusedCourse?.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <StatusChip
              label={`${summarizeCompletedCourses(plannerState)} done`}
              tone="green"
            />
            <StatusChip
              label={`${summarizeInProgressCourses(plannerState)} taking`}
              tone="gold"
            />
            <StatusChip
              label={`${summarizeNotTakenCourses(plannerState)} not taken`}
              tone="stone"
            />
          </div>
          <input
            className="field-input max-w-md"
            placeholder="Search courses, departments, or codes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            {Object.entries(groupedCourses).map(
              ([department, departmentCourses]) => (
                <section key={department}>
                  <p className="mb-3 text-xs font-semibold tracking-[0.24em] text-[var(--muted)] uppercase">
                    {department}
                  </p>
                  <div className="space-y-3">
                    {departmentCourses.map((course) => {
                      const status =
                        plannerState.courseStatuses[course.code] ?? "notTaken";
                      return (
                        <article
                          key={course.code}
                          className="rounded-[1.5rem] border border-[rgba(16,38,20,0.08)] bg-white/78 p-4 transition-transform duration-200 ease-out hover:-translate-y-0.5"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <button
                              type="button"
                              className="min-w-0 text-left"
                              onClick={() => setFocusedCourseCode(course.code)}
                            >
                              <div className="flex items-center gap-3">
                                <StatusChip
                                  label={statusLabel(status)}
                                  tone={statusTone(status)}
                                />
                                <div>
                                  <h2 className="text-base font-semibold text-[var(--green-900)]">
                                    {course.title}
                                  </h2>
                                  <p className="text-sm text-[var(--muted)]">
                                    {course.code}
                                  </p>
                                </div>
                              </div>
                            </button>
                            <div className="flex flex-wrap gap-2">
                              {(
                                [
                                  ["notTaken", "Not taken"],
                                  ["inProgress", "Taking"],
                                  ["completed", "Done"],
                                ] as const
                              ).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  className={`rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.14em] uppercase transition-colors duration-150 ${
                                    status === value
                                      ? "border-[var(--green-600)] bg-[var(--green-900)] text-white"
                                      : "border-[rgba(16,38,20,0.08)] bg-white text-[var(--muted)] hover:border-[var(--green-500)] hover:text-[var(--green-900)]"
                                  }`}
                                  onClick={() =>
                                    setCourseStatus(course.code, value)
                                  }
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
              ),
            )}
          </div>

          <section className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(244,238,226,0.84))] p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Prerequisite focus
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.06em] text-[var(--green-900)]">
              {focusedCourse?.code}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--copy)]">
              {focusedCourse?.title}
            </p>

            <div className="mt-6 space-y-3">
              {focusedPrerequisites.length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-[rgba(16,38,20,0.14)] bg-white/65 p-4 text-sm text-[var(--copy)]">
                  This course stands on its own and can be taken without a
                  prerequisite chain.
                </div>
              ) : (
                focusedPrerequisites.map((edge) => {
                  const prerequisite = courseByCode.get(edge.prerequisiteCode);
                  const prerequisiteStatus =
                    plannerState.courseStatuses[edge.prerequisiteCode] ??
                    "notTaken";
                  return (
                    <div
                      key={`${edge.courseCode}-${edge.prerequisiteCode}`}
                      className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-white/70 p-4"
                    >
                      <p className="text-xs tracking-[0.18em] text-[var(--muted)] uppercase">
                        Requires
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--green-900)]">
                            {prerequisite?.title}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            {prerequisite?.code}
                          </p>
                        </div>
                        <StatusChip
                          label={statusLabel(prerequisiteStatus)}
                          tone={statusTone(prerequisiteStatus)}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-[rgba(16,38,20,0.08)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--copy)]">
            This state feeds the planner context and is available to the
            schedule and map steps.
          </p>
          <Link
            className="primary-button inline-flex items-center justify-center"
            href="/schedule"
          >
            Continue to schedule
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
