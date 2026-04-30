"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { WorkflowShell } from "@/components/workflow-shell";
import { usePlanner } from "@/components/planner-provider";
import { sections } from "@/lib/seed-data";
import {
  buildScheduleEvents,
  formatTime,
  getBuildingById,
  getCourseByCode,
  getDailySpan,
  getSectionDuration,
  getSectionsForCourse,
  sectionConflicts,
  summarizeCredits,
} from "@/lib/planner";
import { weekDays } from "@/lib/types";
import type { OptimizationKey } from "@/lib/types";

const timeGrid = Array.from({ length: 12 }, (_, index) => `${index + 8}:00`);

const optimizationOptions: { key: OptimizationKey; label: string; copy: string }[] = [
  { key: "clusterMorning", label: "Cluster Morning", copy: "Bias the day toward earlier starts." },
  { key: "clusterNight", label: "Cluster Night", copy: "Push classes later into the day." },
  { key: "compact", label: "Compact Days", copy: "Reduce idle time between classes." },
  {
    key: "minimizeDistance",
    label: "Minimize Distance",
    copy: "Reduce cross-campus movement where possible.",
  },
  {
    key: "maximizeProfessor",
    label: "Maximize Rate My Professor",
    copy: "Favor higher-rated instructors in the seeded schedule bundle.",
  },
];

function courseTone(courseCode: string) {
  if (courseCode.startsWith("CSCE")) return "bg-[#edf8f0] text-[#295928] border-[#9ad27e]";
  if (courseCode.startsWith("MATH")) return "bg-[#eaf4fb] text-[#1d5374] border-[#8ebfe2]";
  if (courseCode.startsWith("GOVT")) return "bg-[#faf3de] text-[#7a5e12] border-[#d4b35b]";
  return "bg-[#f3ebfb] text-[#56357a] border-[#c9b0ea]";
}

export function ScheduleClient() {
  const { plannerState, scheduleEvents, setOptimization, setSection } = usePlanner();
  const [focusedCourseCode, setFocusedCourseCode] = useState("");
  const currentCourseCodes = useMemo(() => Object.keys(plannerState.selectedSections), [plannerState.selectedSections]);
  const activeFocusedCourseCode = currentCourseCodes.includes(focusedCourseCode)
    ? focusedCourseCode
    : currentCourseCodes[0] ?? "";

  const focusedSections = useMemo(() => getSectionsForCourse(activeFocusedCourseCode), [activeFocusedCourseCode]);
  const focusedCourse = getCourseByCode(activeFocusedCourseCode);

  const selectedSections = useMemo(
    () =>
      Object.values(plannerState.selectedSections)
        .map((sectionId) => sections.find((section) => section.id === sectionId))
        .filter((section): section is NonNullable<typeof section> => Boolean(section)),
    [plannerState.selectedSections],
  );

  const currentEvents = useMemo(() => buildScheduleEvents(plannerState), [plannerState]);

  return (
    <WorkflowShell
      step={1}
      eyebrow="Optimization"
      title="Shape the semester around one planning goal."
      description="Keep the calendar dominant, use the left rail for focused adjustments, and swap sections without losing track of the bigger weekly rhythm."
    >
      <div className="grid gap-6 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="surface-panel px-5 py-5">
            <p className="editorial-label">Planner summary</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="subtle-panel px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  Credits
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-[color:var(--green-900)]">
                  {summarizeCredits(plannerState)}
                </p>
              </div>
              <div className="subtle-panel px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  Longest day
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-[color:var(--green-900)]">
                  {Math.round(
                    Math.max(
                      ...weekDays.map((day) => getDailySpan(scheduleEvents.filter((event) => event.day === day))),
                    ) / 60,
                  )}
                  h
                </p>
              </div>
            </div>
          </div>

          <div className="surface-panel px-5 py-5">
            <p className="editorial-label">Optimization</p>
            <div className="mt-4 space-y-3">
              {optimizationOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`w-full rounded-[1.4rem] border p-4 text-left transition-all duration-200 ${
                    plannerState.optimization === option.key
                      ? "border-[rgba(79,127,95,0.26)] bg-[color:var(--green-100)] shadow-[0_14px_24px_rgba(20,65,33,0.06)]"
                      : "border-[color:var(--line)] bg-[rgba(255,255,255,0.84)] hover:border-[rgba(79,127,95,0.22)]"
                  }`}
                  onClick={() => setOptimization(option.key)}
                >
                  <p className="text-sm font-semibold text-[color:var(--green-900)]">{option.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--copy)]">{option.copy}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="surface-panel px-5 py-5">
            <p className="editorial-label">Section swap</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.06em] text-[color:var(--green-900)]">
              {focusedCourse?.code ?? "No courses"}
            </h2>
            <p className="mt-1 text-sm text-[color:var(--copy)]">
              {focusedCourse?.title ?? "Mark courses as Taking on the Courses page to build a schedule."}
            </p>
            <div className="mt-4 space-y-3">
              {focusedSections.map((section) => {
                const conflicts = sectionConflicts(
                  section,
                  selectedSections.filter((selectedSection) => selectedSection.courseCode !== section.courseCode),
                );
                const selected = plannerState.selectedSections[activeFocusedCourseCode] === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`w-full rounded-[1.4rem] border p-4 text-left transition-colors duration-150 ${
                      selected
                        ? "border-[rgba(79,127,95,0.28)] bg-[color:var(--green-100)]"
                        : conflicts
                          ? "cursor-not-allowed border-[color:var(--line)] bg-[rgba(32,50,34,0.04)] opacity-55"
                          : "border-[color:var(--line)] bg-[rgba(255,255,255,0.84)] hover:border-[rgba(79,127,95,0.24)]"
                    }`}
                    disabled={conflicts}
                    onClick={() => setSection(activeFocusedCourseCode, section.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--green-900)]">{section.professor}</p>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {section.meetings.map((meeting) => `${meeting.day} ${formatTime(meeting.start)}`).join(" · ")}
                        </p>
                      </div>
                      <StatusChip label={`${section.rating.toFixed(1)} rating`} tone="gold" />
                    </div>
                    <p className="mt-3 text-xs text-[color:var(--copy)]">
                      {Math.round(getSectionDuration(section) / 60)} hours total instruction time
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="surface-panel px-5 py-5">
            <div className="flex flex-wrap gap-2">
              {currentCourseCodes.length === 0 ? (
                <p className="text-sm text-[color:var(--copy)]">
                  No current courses yet. Return to Courses and mark at least one course as Taking.
                </p>
              ) : null}
              {currentCourseCodes.map((courseCode) => (
                <button
                  key={courseCode}
                  type="button"
                  className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] ${courseTone(
                    courseCode,
                  )}`}
                  onClick={() => setFocusedCourseCode(courseCode)}
                >
                  {courseCode}
                </button>
              ))}
            </div>
          </div>

          <div className="surface-panel overflow-hidden">
            <div className="grid grid-cols-[70px_repeat(5,minmax(0,1fr))] border-b border-[color:var(--line)] bg-[rgba(32,50,34,0.03)]">
              <div className="border-r border-[color:var(--line)] p-4" />
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="border-r border-[color:var(--line)] p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)] last:border-r-0"
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[70px_repeat(5,minmax(0,1fr))]">
              {timeGrid.map((time, rowIndex) => (
                <div key={time} className="contents">
                  <div className="border-r border-b border-[color:var(--line)] px-3 pt-3 text-right text-[11px] font-medium text-[color:var(--muted)]">
                    {time}
                  </div>
                  {weekDays.map((day) => (
                    <div
                      key={`${day}-${time}`}
                      className="relative min-h-[88px] border-r border-b border-[color:var(--line)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,246,239,0.88))] last:border-r-0"
                    >
                      {currentEvents
                        .filter(
                          (event) =>
                            event.day === day && Number.parseInt(event.start.slice(0, 2), 10) === rowIndex + 8,
                        )
                        .map((event) => {
                          const building = getBuildingById(event.buildingId);
                          return (
                            <button
                              key={event.sectionId}
                              type="button"
                              className={`absolute inset-x-2 top-2 rounded-[1.1rem] border px-3 py-3 text-left shadow-[0_10px_24px_rgba(19,27,18,0.08)] transition-transform duration-200 ease-out hover:-translate-y-0.5 ${courseTone(
                                event.courseCode,
                              )}`}
                              onClick={() => setFocusedCourseCode(event.courseCode)}
                            >
                              <p className="text-xs font-semibold uppercase tracking-[0.14em]">{event.courseCode}</p>
                              <p className="mt-1 text-sm font-semibold">{event.title}</p>
                              <p className="mt-1 text-xs">
                                {formatTime(event.start)} - {formatTime(event.end)}
                              </p>
                              <p className="mt-1 text-xs text-current/75">
                                {building?.shortName} · {event.professor}
                              </p>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="surface-panel flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[color:var(--copy)]">
              Select any event to inspect alternate sections without losing the broader schedule context.
            </p>
            <Link className="primary-button" href="/map">
              Continue to map
            </Link>
          </div>
        </section>
      </div>
    </WorkflowShell>
  );
}
