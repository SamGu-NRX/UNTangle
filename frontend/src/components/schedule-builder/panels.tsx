"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { AlertGlyph, ChevronRight } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import type { Section } from "@/lib/sections";
import { figuresOf } from "./answer";
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

type Week = { events: readonly GridEvent[]; walks: readonly WalkLeg[]; sections: readonly Section[] };

/** Details for the alternative on the grid: its figures beside the current week, and what changes. */
export function OptionDetails({
  now,
  option,
  label,
  reasons,
  onUse,
  canUse,
}: {
  now: Week;
  option: Week;
  label: string;
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
    ["First class", time(a.first), time(b.first), (a.first ?? 0) - (b.first ?? 0)],
    ["Last class ends", time(a.last), time(b.last), (b.last ?? 0) - (a.last ?? 0)],
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
