"use client";

import type { CSSProperties } from "react";
import styles from "./schedule.module.css";
import { rangeLabel } from "@/lib/planner-sections";
import { clock, courseColor, daysShown, hourRange, laneLayout, usualRange, type WeekEvent } from "./week-model";

const HOUR_PX = 56;

function LockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * The week. Events are buttons named "{COURSE} {START} – {END} {PROFESSOR}"
 * by their own text (the accessible-name contract the M6 journey checks).
 * `ghosts` are another schedule's classes drawn dashed on top, for previewing
 * an alternative; they are decorative and hidden from assistive tech.
 * `rangeEvents` fixes the hours shown (default: events and ghosts), so a
 * preview can be kept from resizing the grid. Weekend columns appear only
 * when a class meets then. Classes sharing a slot in different weeks (first
 * and second eight-week sessions) sit side by side, each with its dates.
 */
export function WeekGrid({
  events,
  courseOrder,
  lockedSections,
  conflictSections,
  rangeEvents,
  ghosts = [],
  ghostsInstant = false,
  dimmedCourses = [],
  onSelect,
  label,
}: {
  events: WeekEvent[];
  courseOrder: string[];
  lockedSections: Record<string, string>;
  conflictSections: Set<string>;
  rangeEvents?: WeekEvent[];
  ghosts?: WeekEvent[];
  /** Ghosts from a keyboard preview appear without the fade. */
  ghostsInstant?: boolean;
  dimmedCourses?: string[];
  onSelect: (courseCode: string) => void;
  /** The grid's accessible name, which says where the sections come from. */
  label: string;
}) {
  const { first, last } = hourRange([...(rangeEvents ?? events), ...ghosts]);
  const days = daysShown([...(rangeEvents ?? events), ...ghosts]);
  const lanes = laneLayout(events);
  const usual = usualRange(events);
  /** Narrows an event to its lane when it shares the slot with a class in other weeks. */
  const laneStyle = (event: WeekEvent): CSSProperties => {
    const place = lanes.get(event);
    if (!place || place.lanes === 1) return {};
    return {
      left: `calc(${place.lane} * 100% / ${place.lanes} + 2px)`,
      right: `calc(${place.lanes - place.lane - 1} * 100% / ${place.lanes} + 2px)`,
    };
  };
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const height = (last - first) * HOUR_PX;
  const top = (minutes: number) => ((minutes - first * 60) / 60) * HOUR_PX;
  // Hour hairlines are the background; half-hours are dashed lines drawn under the events (DESIGN.md §4 ScheduleGrid).
  const lines = {
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--line) ${HOUR_PX - 1}px ${HOUR_PX}px)`,
  };

  return (
    <section className={styles.gridWrap} aria-label={label} style={{ ["--days" as string]: days.length }}>
      <div className={styles.dayHead} aria-hidden="true">
        <div />
        {days.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className={styles.grid} style={{ height, ...lines }}>
        {hours.map((hour) => (
          <span key={`half-${hour}`} className={styles.halfLine} style={{ top: (hour - first) * HOUR_PX + HOUR_PX / 2 }} aria-hidden="true" />
        ))}
        <div className={styles.gutter} aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour} style={{ top: (hour - first) * HOUR_PX }}>
              {hour === 12 ? "12 PM" : hour > 12 ? hour - 12 : hour === first ? `${hour} AM` : hour}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} className={styles.day} data-day={day}>
            {events
              .filter((event) => event.day === day)
              .map((event) => {
                const locked = lockedSections[event.courseCode] === event.sectionId;
                const conflict = conflictSections.has(event.sectionId);
                const tall = event.end - event.start >= 60;
                const describedBy = `ev-${event.sectionId}-${day}-${event.start}`;
                const dates = rangeLabel(event.dates);
                const ownDates = dates !== null && dates !== usual ? dates : null;
                return (
                  <button
                    key={`${event.sectionId}-${day}-${event.start}`}
                    type="button"
                    className={styles.event}
                    data-conflict={conflict ? "true" : "false"}
                    aria-describedby={describedBy}
                    data-dimmed={dimmedCourses.includes(event.courseCode) ? "true" : "false"}
                    style={{
                      ...courseColor(courseOrder, event.courseCode),
                      top: top(event.start) + 2,
                      height: top(event.end) - top(event.start) - 4,
                      ...laneStyle(event),
                    }}
                    onClick={() => onSelect(event.courseCode)}
                  >
                    {/* Described, not named: the name stays "{COURSE} {START} – {END} {PROFESSOR}". */}
                    <span id={describedBy} hidden>
                      {[day, ownDates, locked ? "locked" : null, conflict ? "overlaps another class" : null].filter(Boolean).join(", ")}
                    </span>
                    <span className={styles.eventCode}>
                      {event.courseCode}
                      {locked ? <LockGlyph /> : null}
                    </span>
                    {/* Phone columns fit only the start time; hidden from the name, which already has it. */}
                    <span className={styles.eventStart} aria-hidden="true">
                      {clock(event.start)}
                    </span>
                    <span className={`${styles.eventMeta} ${styles.eventRange}`}>
                      {clock(event.start, true)} – {clock(event.end, true)}
                    </span>
                    <span className={`${styles.eventMeta} ${styles.eventExtra}`} style={tall ? undefined : { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
                      {event.professor}
                    </span>
                    {ownDates ? (
                      <span className={styles.eventMeta} aria-hidden="true">
                        {ownDates}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            {ghosts
              .filter((event) => event.day === day)
              .map((event) => (
                <div
                  key={`ghost-${event.sectionId}-${day}-${event.start}`}
                  className={styles.ghostEvent}
                  data-instant={ghostsInstant ? "true" : "false"}
                  aria-hidden="true"
                  style={{ ...courseColor(courseOrder, event.courseCode), top: top(event.start) + 2, height: top(event.end) - top(event.start) - 4 }}
                >
                  {event.courseCode}
                </div>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A small week for comparing alternatives; moved courses get an outline. */
export function MiniWeek({ events, courseOrder, moved, label }: { events: WeekEvent[]; courseOrder: string[]; moved: string[]; label: string }) {
  const first = 8;
  const last = Math.max(18, ...events.map((event) => Math.ceil(event.end / 60)));
  const height = 96;
  const scale = height / ((last - first) * 60);
  const days = daysShown(events);
  return (
    <div className={styles.mini} role="img" aria-label={label} style={{ ["--days" as string]: days.length }}>
      {days.map((day) => (
        <div key={day} className={styles.miniDay} style={{ height }}>
          {events
            .filter((event) => event.day === day)
            .map((event) => (
              <span
                key={`${event.sectionId}-${event.start}`}
                className={styles.miniEvent}
                data-moved={moved.includes(event.courseCode) ? "true" : "false"}
                style={{
                  ...courseColor(courseOrder, event.courseCode),
                  top: Math.max(0, (event.start - first * 60) * scale),
                  height: Math.max(3, (event.end - event.start) * scale),
                }}
              />
            ))}
          <span className={styles.miniLabel} aria-hidden="true">
            {day.slice(0, 1)}
          </span>
        </div>
      ))}
    </div>
  );
}
