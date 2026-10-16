"use client";

import { Button } from "@/components/ui/Button";
import { AlertGlyph, ChevronRight } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import type { Section } from "@/lib/sections";
import { endGain, figuresOf, startGain, type TimeLean } from "./answer";
import styles from "./builder.module.css";
import type { WeekCourse } from "./host";
import { SectionRows } from "./SectionRows";
import { clock, patternOf, type GridEvent, type WalkLeg } from "./week";

/** A selected event's course: keep it, switch its section, or remove it. */
export function EventPanel(props: {
  course: WeekCourse;
  options: readonly Section[] | null;
  week: readonly Section[];
  termLabel: string;
  onKeep: (kept: boolean) => void;
  onMove: (section: Section, overlaps: string[], fromKeyboard: boolean) => void;
  onPreview: (section: Section | null) => void;
  onRemove: (fromKeyboard: boolean) => void;
}) {
  const { course } = props;
  return (
    <div className={styles.panelBody}>
      <p className={styles.meta}>{course.title}</p>
      {course.note ? <p className={styles.note}>{course.note}</p> : null}
      {course.section ? (
        <Switch checked={course.locked} onChange={props.onKeep} label="Keep this section" description="Auto won't move it." className={styles.keep} />
      ) : null}
      <section aria-labelledby="event-sections">
        <h3 id="event-sections" className={styles.label}>
          Sections
        </h3>
        {props.options === null ? (
          <p className={styles.hint}>Loading sections.</p>
        ) : (
          <SectionRows
            courseCode={course.code}
            sections={props.options}
            week={props.week}
            currentId={course.section?.id ?? null}
            verb="move"
            onPlace={props.onMove}
            onPreview={props.onPreview}
          />
        )}
      </section>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" className={styles.danger} onClick={(event) => props.onRemove(event.detail === 0)}>
          Remove from {props.termLabel}
        </Button>
      </div>
    </div>
  );
}

type Week = { events: readonly GridEvent[]; walks: readonly WalkLeg[]; sections: readonly Section[] };

/** Details for the alternative on the grid: its figures beside the current week, and what changes. */
export function OptionDetails({
  now,
  option,
  label,
  reasons,
  onUse,
  canUse,
  lean,
}: {
  now: Week;
  option: Week;
  label: string;
  /** The student's time-of-day lean: an 8:00 start is better, not worse, for a student who asked for mornings. */
  lean: TimeLean;
  /** One line each, seat warnings first (OptionsFeed.explain). */
  reasons: ReadonlyArray<{ sentence: string; warning: boolean }>;
  onUse: () => void;
  canUse: boolean;
}) {
  const a = figuresOf(now.events, now.walks);
  const b = figuresOf(option.events, option.walks);
  const time = (value: number | null) => (value === null ? "None" : clock(value));
  // [label, now, option, change: negative is better]
  const rows: Array<[string, string, string, number]> = [
    ["Days on campus", String(a.days.length), String(b.days.length), b.days.length - a.days.length],
    ["First class", time(a.first), time(b.first), -startGain(a.first ?? 0, b.first ?? 0, lean)],
    ["Last class ends", time(a.last), time(b.last), -endGain(a.last ?? 0, b.last ?? 0, lean)],
    ["Walking a week", `${a.walkMinutes} min`, `${b.walkMinutes} min`, b.walkMinutes - a.walkMinutes],
    ["Tight or late walks", String(a.badWalks), String(b.badWalks), b.badWalks - a.badWalks],
  ];
  const before = new Map(now.sections.map((section) => [section.courseCode, section]));
  const changes = option.sections.filter((section) => before.get(section.courseCode)?.id !== section.id);
  return (
    <div className={styles.panelBody}>
      {reasons.length > 0 ? (
        <ul className={styles.reasons} aria-label={`Why ${label}`}>
          {reasons.map((reason) => (
            <li key={reason.sentence} data-warning={reason.warning ? "" : undefined}>
              {reason.warning ? <AlertGlyph size={16} /> : null}
              {reason.sentence}
            </li>
          ))}
        </ul>
      ) : null}
      <table className={styles.compare}>
        <thead>
          <tr>
            <td />
            <th scope="col">Now</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, x, y, change]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{x}</td>
              <td data-change={change < 0 ? "better" : change > 0 ? "worse" : undefined}>{y}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length > 0 ? (
        <section aria-labelledby="option-changes">
          <h3 id="option-changes" className={styles.label}>
            Sections that change
          </h3>
          <ul className={styles.changes}>
            {changes.map((section) => {
              const from = before.get(section.courseCode);
              return (
                <li key={section.courseCode}>
                  <b className={styles.code}>{section.courseCode}</b>
                  {from ? (
                    <>
                      <s>{patternOf(from)}</s>
                      <ChevronRight size={14} />
                    </>
                  ) : null}
                  <span>{patternOf(section)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <div className={styles.actions}>
        <Button size="sm" disabled={!canUse} onClick={onUse}>
          Use this
        </Button>
      </div>
    </div>
  );
}
