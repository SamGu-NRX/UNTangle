"use client";

import { Check, LockGlyph, Plus } from "@/components/ui/icons";
import type { Section } from "@/lib/sections";
import styles from "./builder.module.css";
import { sectionConflicts } from "./conflicts";
import { examDay, examStartTime, finalClashes } from "./finals";
import type { BuilderFinals } from "./host";
import { andList, patternOf, sectionLabel } from "./week";

type Props = {
  courseCode: string;
  sections: readonly Section[];
  /** The sections on the week now, for the clash check before adding. */
  week: readonly Section[];
  /** The course's section on the week, if any. */
  currentId: string | null;
  /** Add from search; move from the selected event's panel. */
  verb: "add" | "move";
  /** A class number search lands on its section, which goes first. */
  highlightId?: string | null;
  onPlace: (section: Section, overlaps: string[], fromKeyboard: boolean) => void;
  /** Paints the section on the grid while pointed at, focused or tapped; null clears it. */
  onPreview: (section: Section | null) => void;
  /** Each section's final, when the host knows them: a known one is shown, and a clash with the week is named. */
  finals?: BuilderFinals | null;
};

const seats = (section: Section) =>
  section.seats.open === null ? null : section.seats.open === 0 ? "full" : `${section.seats.open} open`;

/**
 * A course's sections, each with a one-tap button. A clash shows on the row
 * before the tap (red outline, "Overlaps MATH 2700 on Mon and Wed"); a
 * closed section can't be added.
 */
export function SectionRows({ courseCode, sections, week, currentId, verb, highlightId, onPlace, onPreview, finals }: Props) {
  const ordered = [...sections].sort(
    (a, b) => Number(b.id === currentId) - Number(a.id === currentId) || Number(b.id === highlightId) - Number(a.id === highlightId),
  );
  if (ordered.length === 0) return <p className={styles.hint}>No sections this term.</p>;
  return (
    <ul className={styles.sections} aria-label={`${courseCode} sections`}>
      {ordered.map((section) => {
        const on = section.id === currentId;
        const conflicts = sectionConflicts(week, section);
        const full = section.status === "closed" && !on;
        const instructor = section.instructor.display;
        const rooms = [...new Set(section.meetings.filter((m) => m.kind === "building").map((m) => m.room))].join(" and ");
        const detail = [instructor, rooms, seats(section)].filter(Boolean).join(", ");
        const overlaps = conflicts.map((c) => c.courseCode);
        const exam = finals?.examOf(section);
        const examClashes = finals && !on ? finalClashes(section, week, finals) : [];
        const label = on
          ? `Section ${sectionLabel(section)}, in your week`
          : full
            ? `Section ${sectionLabel(section)}, full`
            : `${verb === "move" ? "Move to" : "Add"} section ${sectionLabel(section)}${overlaps.length ? `, overlaps ${andList(overlaps)}` : ""}${
                examClashes.length ? `, final at the same time as ${andList(examClashes)}` : ""
              }`;
        return (
          <li
            key={section.id}
            className={styles.section}
            data-highlight={section.id === highlightId ? "" : undefined}
            onPointerEnter={(event) => event.pointerType === "mouse" && onPreview(section)}
            onPointerLeave={(event) => event.pointerType === "mouse" && onPreview(null)}
            onFocus={() => onPreview(section)}
            onBlur={() => onPreview(null)}
          >
            <button
              type="button"
              className={styles.place}
              data-state={on ? "on" : full ? "full" : overlaps.length ? "clash" : "add"}
              // A full section stays focusable, so the keyboard can still preview it on the grid.
              disabled={on}
              aria-disabled={full || undefined}
              aria-label={label}
              onClick={(event) => {
                if (!full) onPlace(section, overlaps, event.detail === 0);
              }}
            >
              {on ? <Check size={16} /> : full ? <LockGlyph size={16} /> : <Plus size={18} />}
            </button>
            {/* Tapping the text previews on touch, where nothing can be pointed at. */}
            <div className={styles.sectionText} onClick={() => onPreview(section)}>
              <div className={styles.sectionLine}>
                <span className={styles.sectionCode}>§{sectionLabel(section)}</span>
                {patternOf(section)}
              </div>
              {detail ? <div className={styles.meta}>{detail}</div> : null}
              {exam?.kind === "known" ? (
                <div className={styles.meta}>
                  Final {examDay(exam.exam)}, {examStartTime(exam.exam)}
                </div>
              ) : null}
              {conflicts.map((conflict) => (
                <div key={conflict.courseCode} className={styles.clash}>
                  Overlaps {conflict.courseCode} on {andList(conflict.days)}
                </div>
              ))}
              {examClashes.length ? <div className={styles.clash}>Final at the same time as {andList(examClashes)}</div> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
