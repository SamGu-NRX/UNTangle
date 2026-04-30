"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { NavShell } from "@/components/nav-shell";
import { Modal } from "@/components/ui/Modal";
import { ConflictBanner } from "@/components/ui/ConflictBanner";
import { StatusMark } from "@/components/ui/StatusMark";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { usePlanner, useToast } from "@/components/planner-provider";
import { sections } from "@/lib/seed-data";
import {
  formatTime,
  getActiveCourseCodes,
  getCourseByCode,
  getDailySpan,
  getSectionDuration,
  getSectionsForCourse,
  getUnscheduledActiveCourses,
  sectionConflicts,
  summarizeCredits,
} from "@/lib/planner";
import { weekDays } from "@/lib/types";
import type { OptimizationKey, ScheduleEvent } from "@/lib/types";

const TIME_GRID = Array.from({ length: 12 }, (_, i) => i + 8); // 8 → 19 (8am - 7pm)

const optimizationOptions: { key: OptimizationKey; label: string; copy: string }[] = [
  { key: "clusterMorning", label: "Cluster mornings", copy: "Bias toward earlier starts." },
  { key: "clusterNight", label: "Cluster nights", copy: "Push classes later in the day." },
  { key: "compact", label: "Compact days", copy: "Reduce idle time between classes." },
  { key: "minimizeDistance", label: "Minimize walking", copy: "Reduce cross-campus movement." },
  { key: "maximizeProfessor", label: "Strong professors", copy: "Favor higher-rated instructors." },
];

function paletteIndex(courseCode: string) {
  let h = 0;
  for (let i = 0; i < courseCode.length; i++) h = (h * 31 + courseCode.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

function paletteVars(courseCode: string): CSSProperties {
  const i = paletteIndex(courseCode);
  return {
    ["--ev-bg" as string]: `var(--course-${i}-bg)`,
    ["--ev-border" as string]: `var(--course-${i}-border)`,
    ["--ev-solid" as string]: `var(--course-${i}-solid)`,
  } as CSSProperties;
}

function eventLayout(event: ScheduleEvent) {
  const [sh, sm] = event.start.split(":").map(Number);
  const [eh, em] = event.end.split(":").map(Number);
  const startMinutes = sh * 60 + sm - 8 * 60;
  const endMinutes = eh * 60 + em - 8 * 60;
  // grid is 12 hours = 720 minutes, each row min-height 64px
  // place absolutely within the day column wrapper (see render)
  return {
    top: (startMinutes / 60) * 64 + 4,
    height: ((endMinutes - startMinutes) / 60) * 64 - 4,
  };
}

export function ScheduleClient() {
  const { plannerState, scheduleEvents, setOptimization, setSection } = usePlanner();
  const { toast } = useToast();
  const [pickerCourseCode, setPickerCourseCode] = useState<string | null>(null);
  const [pickerOrigin, setPickerOrigin] = useState<{ x: number; y: number } | null>(null);

  const selectedSections = useMemo(
    () =>
      Object.values(plannerState.selectedSections)
        .map((sectionId) => sections.find((s) => s.id === sectionId))
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [plannerState.selectedSections],
  );

  const conflicts = useMemo(() => {
    const issues: string[] = [];
    for (let i = 0; i < selectedSections.length; i++) {
      for (let j = i + 1; j < selectedSections.length; j++) {
        const overlap = selectedSections[i].meetings.some((a) =>
          selectedSections[j].meetings.some(
            (b) =>
              a.day === b.day &&
              ((a.start < b.end && b.start < a.end) || (b.start < a.end && a.start < b.end)),
          ),
        );
        if (overlap) {
          issues.push(`${selectedSections[i].courseCode} ↔ ${selectedSections[j].courseCode}`);
        }
      }
    }
    return issues;
  }, [selectedSections]);

  const longestDayHours = Math.round(
    Math.max(
      ...weekDays.map((day) => getDailySpan(scheduleEvents.filter((e) => e.day === day))),
      0,
    ) / 60,
  );

  const earliestStart = useMemo(() => {
    if (scheduleEvents.length === 0) return "—";
    return formatTime(scheduleEvents.map((e) => e.start).sort()[0]);
  }, [scheduleEvents]);

  const latestEnd = useMemo(() => {
    if (scheduleEvents.length === 0) return "—";
    return formatTime(scheduleEvents.map((e) => e.end).sort().reverse()[0]);
  }, [scheduleEvents]);

  function openPicker(courseCode: string, e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setPickerCourseCode(courseCode);
  }

  const pickerSections = pickerCourseCode ? getSectionsForCourse(pickerCourseCode) : [];
  const pickerCourse = pickerCourseCode ? getCourseByCode(pickerCourseCode) : undefined;
  const activeCourseCodes = useMemo(() => getActiveCourseCodes(plannerState), [plannerState]);
  const unscheduledActiveCourses = useMemo(
    () => getUnscheduledActiveCourses(plannerState),
    [plannerState],
  );

  return (
    <NavShell
      step={1}
      back={{ href: "/courses", label: "Courses" }}
      next={{ href: "/map", label: "Generate map" }}
    >
      <div style={{ display: "grid", gap: 18 }}>
        <header>
          <p className="editorial-label">Step 2 — Schedule</p>
          <h1
            className="font-display"
            style={{
              marginTop: 4,
              fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            Shape the semester around one planning goal.
          </h1>
        </header>

        {conflicts.length > 0 ? (
          <ConflictBanner>
            Time conflict detected: {conflicts.join(" · ")}. Click an event to swap sections.
          </ConflictBanner>
        ) : null}

        {unscheduledActiveCourses.length > 0 ? (
          <ConflictBanner>
            No section data yet for {unscheduledActiveCourses.map((course) => course.code).join(", ")}.
            Those courses are marked Taking, but they will not appear on the map until a section exists.
          </ConflictBanner>
        ) : null}

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)" }}>
          {/* Sidebar */}
          <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <section className="surface-card" style={{ padding: "0.95rem 1rem" }}>
              <p className="editorial-label" style={{ marginBottom: 10 }}>
                Optimization
              </p>
              <div style={{ display: "grid", gap: 6 }}>
                <StaggerGroup step={30}>
                  {optimizationOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className="opt-row"
                      data-active={plannerState.optimization === opt.key ? "true" : "false"}
                      onClick={() => {
                        if (plannerState.optimization !== opt.key) {
                          setOptimization(opt.key);
                          toast(`Re-optimized: ${opt.label}`);
                        }
                      }}
                    >
                      <span className="opt-dot" />
                      <span style={{ minWidth: 0 }}>
                        <span className="opt-row__label" style={{ display: "block" }}>
                          {opt.label}
                        </span>
                        <span className="opt-row__copy" style={{ display: "block" }}>
                          {opt.copy}
                        </span>
                      </span>
                    </button>
                  ))}
                </StaggerGroup>
              </div>
            </section>

            <section className="surface-card" style={{ padding: "0.95rem 1rem" }}>
              <p className="editorial-label" style={{ marginBottom: 8 }}>
                Active courses
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedSections.map((s) => (
                  <span key={s.id} className="course-pill" style={paletteVars(s.courseCode)}>
                    {s.courseCode}
                  </span>
                ))}
                {unscheduledActiveCourses.map((course) => (
                  <span key={course.code} className="course-pill" style={{ opacity: 0.64 }}>
                    {course.code}
                  </span>
                ))}
                {activeCourseCodes.length === 0 ? (
                  <span style={{ fontSize: "0.82rem", color: "var(--copy)" }}>
                    Mark courses as &ldquo;Taking&rdquo; on the previous step.
                  </span>
                ) : null}
              </div>
            </section>

            <section className="surface-card" style={{ padding: "0.95rem 1rem" }}>
              <p className="editorial-label" style={{ marginBottom: 10 }}>
                Stats
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  fontSize: "0.85rem",
                }}
              >
                <Metric label="Credits" value={String(summarizeCredits(plannerState))} />
                <Metric label="Longest day" value={`${longestDayHours}h`} />
                <Metric label="Earliest" value={earliestStart} />
                <Metric label="Latest" value={latestEnd} />
              </div>
            </section>
          </aside>

          {/* Calendar */}
          <section className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="cal-grid">
              <div className="cal-head" />
              {weekDays.map((day) => (
                <div key={day} className="cal-head">
                  {day}
                </div>
              ))}

              {/* Time labels column + 5 day columns */}
              <div style={{ gridColumn: "1 / 2" }}>
                {TIME_GRID.map((hour) => (
                  <div key={hour} className="cal-time" style={{ height: 64 }}>
                    {((hour - 1) % 12) + 1}
                    {hour < 12 ? " AM" : " PM"}
                  </div>
                ))}
              </div>

              {weekDays.map((day) => (
                <div key={day} style={{ gridColumn: "auto", position: "relative" }}>
                  {TIME_GRID.map((hour) => (
                    <div
                      key={hour}
                      className="cal-cell"
                      style={{ height: 64, position: "relative" }}
                    />
                  ))}
                  {scheduleEvents
                    .filter((e) => e.day === day)
                    .map((event) => {
                      const layout = eventLayout(event);
                      return (
                        <button
                          key={event.sectionId + day + event.start}
                          type="button"
                          className="cal-event"
                          style={{
                            ...paletteVars(event.courseCode),
                            top: layout.top,
                            height: layout.height,
                          }}
                          onClick={(e) => openPicker(event.courseCode, e)}
                        >
                          <div className="cal-event__title">{event.courseCode}</div>
                          <div className="cal-event__meta">
                            {formatTime(event.start)} – {formatTime(event.end)}
                          </div>
                          <div className="cal-event__meta" style={{ opacity: 0.7 }}>
                            {event.professor}
                          </div>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={pickerCourseCode !== null}
        onClose={() => setPickerCourseCode(null)}
        origin={pickerOrigin}
        title={
          <div>
            <p className="editorial-label">Swap section</p>
            <h2
              className="font-display"
              style={{
                marginTop: 4,
                fontSize: "1.3rem",
                fontWeight: 800,
                color: "var(--brand-900)",
                letterSpacing: "-0.03em",
              }}
            >
              {pickerCourse?.code}
            </h2>
            <p style={{ fontSize: "0.82rem", color: "var(--copy)", marginTop: 2 }}>
              {pickerCourse?.title}
            </p>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <StaggerGroup>
            {pickerSections.map((section) => {
              const others = selectedSections.filter((s) => s.courseCode !== section.courseCode);
              const conflict = sectionConflicts(section, others);
              const selected = plannerState.selectedSections[section.courseCode] === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  disabled={conflict}
                  onClick={() => {
                    setSection(section.courseCode, section.id);
                    setPickerCourseCode(null);
                    toast(`✓ Section updated · ${section.courseCode}`);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "0.85rem 1rem",
                    border: `1px solid ${selected ? "var(--brand-500)" : "var(--line)"}`,
                    background: selected ? "var(--success-bg)" : conflict ? "var(--surface-muted)" : "var(--surface)",
                    borderRadius: "var(--r-md)",
                    cursor: conflict ? "not-allowed" : "pointer",
                    opacity: conflict ? 0.55 : 1,
                    transition:
                      "border-color 150ms var(--ease), background-color 150ms var(--ease)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 700, color: "var(--ink)" }}>{section.professor}</p>
                      <p style={{ fontSize: "0.78rem", color: "var(--copy)", marginTop: 2 }}>
                        {section.meetings
                          .map((m) => `${m.day} ${formatTime(m.start)}`)
                          .join(" · ")}
                      </p>
                      <p style={{ fontSize: "0.78rem", color: "var(--copy)", marginTop: 2 }}>
                        {Math.round(getSectionDuration(section) / 60)} hrs/week instruction
                      </p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      <StatusMark label={`${section.rating.toFixed(1)} ★`} tone="review" />
                      {conflict ? <StatusMark label="Conflict" tone="danger" /> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </StaggerGroup>
        </div>
      </Modal>
    </NavShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: "0.7rem", color: "var(--copy)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </p>
      <p
        className="font-display"
        style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--brand-900)", letterSpacing: "-0.02em", marginTop: 2 }}
      >
        {value}
      </p>
    </div>
  );
}
