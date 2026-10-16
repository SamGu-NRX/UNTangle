"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { AlertGlyph, ChevronRight } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import type { Section } from "@/lib/sections";
import { endGain, figuresOf, startGain, type TimeLean } from "./answer";
import styles from "./builder.module.css";
import { examLongDay, examTimes, finalClashes } from "./finals";
import type { BuilderFinals, WeekCourse } from "./host";
import { SectionRows } from "./SectionRows";
import { andList, clock, patternOf, type GridEvent, type WalkLeg } from "./week";

/** The selected section's final: when it is, what it clashes with, and where the time comes from. */
function FinalExam({ section, week, finals }: { section: Section; week: readonly Section[]; finals: BuilderFinals }) {
  const exam = finals.examOf(section);
  const clashes = finalClashes(section, week, finals);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.final} data-final="">
      <h3 id={headingId} className={styles.label}>
        Final
      </h3>
      {exam.kind === "known" ? (
        <>
          <p className={styles.finalWhen}>
            {examLongDay(exam.exam)}, {examTimes(exam.exam)}
          </p>
          {clashes.length > 0 ? (
            <p className={exam.projected ? styles.check : styles.clash}>
              {clashes.length === 1 ? `Overlaps the ${clashes[0]} final.` : `Overlaps the ${andList(clashes)} finals.`}
            </p>
          ) : null}
          {exam.projected && finals.projected ? <p className={styles.meta}>{finals.projected.source}</p> : null}
        </>
      ) : (
        <p className={styles.meta}>{exam.note}</p>
      )}
    </section>
  );
}

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
  finals?: BuilderFinals | null;
}) {
  const { course } = props;
  return (
    <div className={styles.panelBody}>
      <p className={styles.meta}>{course.title}</p>
      {course.note ? <p className={styles.note}>{course.note}</p> : null}
      {course.section ? (
        <Switch checked={course.locked} onChange={props.onKeep} label="Keep this section" description="Auto won't move it." className={styles.keep} />
      ) : null}
      {course.section && props.finals ? <FinalExam section={course.section} week={props.week} finals={props.finals} /> : null}
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
            finals={props.finals}
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

/** `unknownWalks`: walks with no known time (week.ts unknownWalksOf), so `walks` says only part of the walking. */
type Week = { events: readonly GridEvent[]; walks: readonly WalkLeg[]; sections: readonly Section[]; unknownWalks: number };

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
  // A week with no timed class has no first or last time to judge against a clock time.
  const timed = (x: number | null, y: number | null, gain: (x: number, y: number) => number) => (x === null || y === null ? 0 : -gain(x, y));
  // A walk with no known time makes the totals lower bounds, which judge nothing.
  const partial = now.unknownWalks > 0 || option.unknownWalks > 0;
  const atLeast = (week: Week, text: string) => (week.unknownWalks > 0 ? `At least ${text}` : text);
  // [label, now, option, change: negative is better]
  const rows: Array<[string, string, string, number]> = [
    ["Days on campus", String(a.days.length), String(b.days.length), b.days.length - a.days.length],
    ["First class", time(a.first), time(b.first), timed(a.first, b.first, (x, y) => startGain(x, y, lean))],
    ["Last class ends", time(a.last), time(b.last), timed(a.last, b.last, (x, y) => endGain(x, y, lean))],
    ["Walking a week", atLeast(now, `${a.walkMinutes} min`), atLeast(option, `${b.walkMinutes} min`), partial ? 0 : b.walkMinutes - a.walkMinutes],
    ["Tight or late walks", atLeast(now, String(a.badWalks)), atLeast(option, String(b.badWalks)), partial ? 0 : b.badWalks - a.badWalks],
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
