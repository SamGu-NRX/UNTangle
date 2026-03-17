"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
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

const optimizationOptions: {
  key: OptimizationKey;
  label: string;
  copy: string;
}[] = [
  {
    key: "clusterMorning",
    label: "Cluster Morning",
    copy: "Bias the day toward earlier starts.",
  },
  {
    key: "clusterNight",
    label: "Cluster Night",
    copy: "Push classes later into the day.",
  },
  {
    key: "compact",
    label: "Compact Days",
    copy: "Reduce idle time between classes.",
  },
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
  if (courseCode.startsWith("CSCE"))
    return "bg-[#edf8f0] text-[#295928] border-[#9ad27e]";
  if (courseCode.startsWith("MATH"))
    return "bg-[#eaf4fb] text-[#1d5374] border-[#8ebfe2]";
  if (courseCode.startsWith("GOVT"))
    return "bg-[#faf3de] text-[#7a5e12] border-[#d4b35b]";
  return "bg-[#f3ebfb] text-[#56357a] border-[#c9b0ea]";
}

export function ScheduleClient() {
  const { plannerState, scheduleEvents, setOptimization, setSection } =
    usePlanner();
  const [focusedCourseCode, setFocusedCourseCode] = useState("CSCE 1030");

  const focusedSections = useMemo(
    () => getSectionsForCourse(focusedCourseCode),
    [focusedCourseCode],
  );
  const focusedCourse = getCourseByCode(focusedCourseCode);

  const selectedSections = useMemo(
    () =>
      Object.values(plannerState.selectedSections)
        .map((sectionId) =>
          sections.find((section) => section.id === sectionId),
        )
        .filter((section): section is NonNullable<typeof section> =>
          Boolean(section),
        ),
    [plannerState.selectedSections],
  );

  const currentEvents = useMemo(
    () => buildScheduleEvents(plannerState),
    [plannerState],
  );

  return (
    <AppShell
      currentStep={2}
      eyebrow="Optimization"
      title="Tune the semester before you commit to it."
      subtitle="The schedule step keeps the original left-rail optimization model, but makes the results easier to read: cleaner day structure, clearer section swapping, and stronger spatial hierarchy between controls and the calendar."
      aside={
        <div className="space-y-4">
          <div className="glass-panel p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Planner stats
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-white/70 p-4">
                <p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">
                  Credits
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-[var(--green-900)]">
                  {summarizeCredits()}
                </p>
              </div>
              <div className="rounded-[1.4rem] border border-[rgba(16,38,20,0.08)] bg-white/70 p-4">
                <p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">
                  Longest day
                </p>
                <p className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-[var(--green-900)]">
                  {Math.round(
                    Math.max(
                      ...weekDays.map((day) =>
                        getDailySpan(
                          scheduleEvents.filter((event) => event.day === day),
                        ),
                      ),
                    ) / 60,
                  )}
                  h
                </p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(244,238,226,0.84))] p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Optimization
            </p>
            <div className="mt-4 space-y-3">
              {optimizationOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`w-full rounded-[1.4rem] border p-4 text-left transition-all duration-200 ${
                    plannerState.optimization === option.key
                      ? "border-[var(--green-500)] bg-[#edf6ef] shadow-[0_14px_24px_rgba(20,65,33,0.08)]"
                      : "border-[rgba(16,38,20,0.08)] bg-white/72 hover:border-[var(--green-400)]"
                  }`}
                  onClick={() => setOptimization(option.key)}
                >
                  <p className="text-sm font-semibold text-[var(--green-900)]">
                    {option.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--copy)]">
                    {option.copy}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-white/80 p-5">
            <p className="text-xs tracking-[0.24em] text-[var(--muted)] uppercase">
              Section swap
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.06em] text-[var(--green-900)]">
              {focusedCourse?.code}
            </h2>
            <p className="mt-1 text-sm text-[var(--copy)]">
              {focusedCourse?.title}
            </p>
            <div className="mt-4 space-y-3">
              {focusedSections.map((section) => {
                const conflicts = sectionConflicts(
                  section,
                  selectedSections.filter(
                    (selectedSection) =>
                      selectedSection.courseCode !== section.courseCode,
                  ),
                );
                const selected =
                  plannerState.selectedSections[focusedCourseCode] ===
                  section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`w-full rounded-[1.4rem] border p-4 text-left transition-colors duration-150 ${
                      selected
                        ? "border-[var(--green-600)] bg-[#edf6ef]"
                        : conflicts
                          ? "cursor-not-allowed border-[rgba(16,38,20,0.08)] bg-[rgba(16,38,20,0.04)] opacity-55"
                          : "border-[rgba(16,38,20,0.08)] bg-white hover:border-[var(--green-400)]"
                    }`}
                    disabled={conflicts}
                    onClick={() => setSection(focusedCourseCode, section.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--green-900)]">
                          {section.professor}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {section.meetings
                            .map(
                              (meeting) =>
                                `${meeting.day} ${formatTime(meeting.start)}`,
                            )
                            .join(" · ")}
                        </p>
                      </div>
                      <StatusChip
                        label={`${section.rating.toFixed(1)} rating`}
                        tone="gold"
                      />
                    </div>
                    <p className="mt-3 text-xs text-[var(--copy)]">
                      {Math.round(getSectionDuration(section) / 60)} hours total
                      instruction time
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {Object.keys(plannerState.selectedSections).map((courseCode) => (
              <button
                key={courseCode}
                type="button"
                className={`rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.15em] uppercase ${courseTone(
                  courseCode,
                )}`}
                onClick={() => setFocusedCourseCode(courseCode)}
              >
                {courseCode}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-[1.8rem] border border-[rgba(16,38,20,0.08)] bg-white/82 shadow-[0_20px_48px_rgba(30,38,22,0.08)]">
            <div className="grid grid-cols-[70px_repeat(5,minmax(0,1fr))] border-b border-[rgba(16,38,20,0.08)] bg-[rgba(16,38,20,0.03)]">
              <div className="border-r border-[rgba(16,38,20,0.08)] p-4" />
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="border-r border-[rgba(16,38,20,0.08)] p-4 text-center text-xs font-semibold tracking-[0.18em] text-[var(--muted)] uppercase last:border-r-0"
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[70px_repeat(5,minmax(0,1fr))]">
              {timeGrid.map((time, rowIndex) => (
                <div key={time} className="contents">
                  <div className="border-r border-b border-[rgba(16,38,20,0.08)] px-3 pt-3 text-right text-[11px] font-medium text-[var(--muted)]">
                    {time}
                  </div>
                  {weekDays.map((day) => (
                    <div
                      key={`${day}-${time}`}
                      className="relative min-h-[88px] border-r border-b border-[rgba(16,38,20,0.08)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(247,244,235,0.86))] last:border-r-0"
                    >
                      {currentEvents
                        .filter(
                          (event) =>
                            event.day === day &&
                            Number.parseInt(event.start.slice(0, 2), 10) ===
                              rowIndex + 8,
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
                              onClick={() =>
                                setFocusedCourseCode(event.courseCode)
                              }
                            >
                              <p className="text-xs font-semibold tracking-[0.14em] uppercase">
                                {event.courseCode}
                              </p>
                              <p className="mt-1 text-sm font-semibold">
                                {event.title}
                              </p>
                              <p className="mt-1 text-xs">
                                {formatTime(event.start)} -{" "}
                                {formatTime(event.end)}
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

          <div className="flex flex-col gap-3 border-t border-[rgba(16,38,20,0.08)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--copy)]">
              Select any event to inspect alternate sections without losing the
              broader schedule context.
            </p>
            <Link
              className="primary-button inline-flex items-center justify-center"
              href="/map"
            >
              Continue to map
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
