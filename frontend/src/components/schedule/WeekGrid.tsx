"use client";

import { weekDays } from "@/lib/types";
import styles from "./schedule.module.css";
import { clock, courseColor, hourRange, type WeekEvent } from "./week-model";

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
 */
export function WeekGrid({
  events,
  courseOrder,
  lockedSections,
  conflictSections,
  ghosts = [],
  dimmedCourses = [],
  onSelect,
}: {
  events: WeekEvent[];
  courseOrder: string[];
  lockedSections: Record<string, string>;
  conflictSections: Set<string>;
  ghosts?: WeekEvent[];
  dimmedCourses?: string[];
  onSelect: (courseCode: string, origin: { x: number; y: number }) => void;
}) {
  const { first, last } = hourRange([...events, ...ghosts]);
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const height = (last - first) * HOUR_PX;
  const top = (minutes: number) => ((minutes - first * 60) / 60) * HOUR_PX;
  const lines = {
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--line, #dde8dd) ${HOUR_PX - 1}px ${HOUR_PX}px)`,
  };

  return (
    <section className={styles.gridWrap} aria-label="Week calendar (sample sections)">
      {/* Sample label outside the events, so it never changes an event's name. */}
      <p className={styles.gridCaption}>Sample sections, times and instructors</p>
      <div className={styles.dayHead} aria-hidden="true">
        <div />
        {weekDays.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className={styles.grid} style={{ height, ...lines }}>
        <div className={styles.gutter} aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour} style={{ top: (hour - first) * HOUR_PX }}>
              {hour === 12 ? "12 PM" : hour > 12 ? hour - 12 : hour === first ? `${hour} AM` : hour}
            </span>
          ))}
        </div>
        {weekDays.map((day) => (
          <div key={day} className={styles.day} data-day={day}>
            {events
              .filter((event) => event.day === day)
              .map((event) => {
                const locked = lockedSections[event.courseCode] === event.sectionId;
                const conflict = conflictSections.has(event.sectionId);
                const tall = event.end - event.start >= 60;
                const describedBy = `ev-${event.sectionId}-${day}-${event.start}`;
                return (
                  <button
                    key={`${event.sectionId}-${day}-${event.start}`}
                    type="button"
                    className={styles.event}
                    data-conflict={conflict ? "true" : "false"}
                    aria-describedby={describedBy}
                    data-dimmed={dimmedCourses.includes(event.courseCode) ? "true" : "false"}
                    style={{ ...courseColor(courseOrder, event.courseCode), top: top(event.start) + 2, height: top(event.end) - top(event.start) - 4 }}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      onSelect(event.courseCode, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
                    }}
                  >
                    {/* Described, not named: the name stays "{COURSE} {START} – {END} {PROFESSOR}". */}
                    <span id={describedBy} hidden>
                      {[day, locked ? "locked" : null, conflict ? "overlaps another class" : null].filter(Boolean).join(", ")}
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
                  </button>
                );
              })}
            {ghosts
              .filter((event) => event.day === day)
              .map((event) => (
                <div
                  key={`ghost-${event.sectionId}-${day}-${event.start}`}
                  className={styles.ghostEvent}
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
  return (
    <div className={styles.mini} role="img" aria-label={label}>
      {weekDays.map((day) => (
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
