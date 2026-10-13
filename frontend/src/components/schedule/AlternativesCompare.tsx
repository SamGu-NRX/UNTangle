"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { UNKNOWN_WALK_SECONDS } from "@/lib/optimizer/score";
import type { RankedSchedule, RelaxSuggestion } from "@/lib/optimizer/types";
import { isTimed, optionLabel, rangeLabel } from "@/lib/planner-sections";
import { classDays } from "@/lib/types";
import { differsInOneCourse, resultStanding, type RunState } from "./run-state";
import styles from "./schedule.module.css";
import { MiniWeek } from "./WeekGrid";
import { clock, eventsFor, movedCourses, type FindOption } from "./week-model";

const LETTERS = ["A", "B", "C", "D", "E"];
const UNKNOWN_WALK_MINUTES = UNKNOWN_WALK_SECONDS / 60;

function minutesText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function Breakdown({ schedule }: { schedule: RankedSchedule }) {
  const b = schedule.breakdown;
  return (
    <dl className={styles.breakdown}>
      <dt>Days on campus</dt>
      <dd>{b.daysOnCampus}</dd>
      <dt>Time between classes</dt>
      <dd>{minutesText(b.gapMinutes)} / wk</dd>
      <dt>Walking</dt>
      <dd>{Math.round(b.walkSeconds / 60)} min / wk</dd>
      {b.unknownWalks > 0 ? (
        <>
          <dt>Walk time unknown</dt>
          <dd>{plural(b.unknownWalks, "walk", "walks")}</dd>
        </>
      ) : null}
      <dt>Earliest – latest</dt>
      <dd>{b.earliestStart === null || b.latestEnd === null ? "—" : `${clock(b.earliestStart)}–${clock(b.latestEnd)}`}</dd>
    </dl>
  );
}

/**
 * Each option's classes as text, for screen readers: the mini week is a
 * picture, and a picture cannot be read day by day.
 */
export function meetingLines(byCourse: Record<string, string>, courseOrder: readonly string[], find: FindOption): string[] {
  const codes = [...Object.keys(byCourse)].sort((a, b) => {
    const ia = courseOrder.indexOf(a);
    const ib = courseOrder.indexOf(b);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || a.localeCompare(b);
  });
  return codes.flatMap((code) => {
    const section = find(code, byCourse[code]);
    if (!section) return [];
    const byTime = new Map<string, { start: number; end: number; dates: string | null; days: string[] }>();
    for (const meeting of section.meetings.filter(isTimed)) {
      const dates = rangeLabel(meeting.dates);
      const key = `${meeting.startMinutes}-${meeting.endMinutes}-${dates}`;
      const entry = byTime.get(key) ?? { start: meeting.startMinutes, end: meeting.endMinutes, dates, days: [] };
      entry.days.push(meeting.day);
      byTime.set(key, entry);
    }
    const times = [...byTime.values()].map(({ start, end, dates, days }) => {
      const ordered = classDays.filter((day) => days.includes(day));
      const offCycle = section.term !== null && section.session.label !== "Regular Academic Session";
      return `${ordered.join(" ")} ${clock(start, true)} to ${clock(end, true)}${offCycle && dates ? `, ${dates}` : ""}`;
    });
    return [`${code} section ${optionLabel(section)}: ${times.join("; ") || "no set time"}`];
  });
}

export function AlternativesCompare({
  state,
  stale,
  current,
  find,
  tag,
  courseOrder,
  onUse,
  onPreview,
  onRelax,
  onClose,
  onRetry,
  instant = false,
}: {
  state: RunState;
  /** The settings changed after this result was found: show it, but nothing in it applies. */
  stale: boolean;
  current: Record<string, string>;
  find: FindOption;
  /** Where the sections come from (the view header's tag). */
  tag: ReactNode;
  courseOrder: string[];
  onUse: (schedule: RankedSchedule, letter: string) => void;
  /** `fromKeyboard` previews appear without a fade. */
  onPreview: (schedule: RankedSchedule | null, fromKeyboard: boolean) => void;
  onRelax: (suggestion: RelaxSuggestion) => void;
  onClose: () => void;
  onRetry: (fromKeyboard: boolean) => void;
  /** The run was started from the keyboard: no entrance animation. */
  instant?: boolean;
}) {
  const sectionProps = { "aria-labelledby": "alternatives-title", className: styles.alternatives, "data-instant": instant ? "true" : "false" };
  const { result } = state;
  const refining = state.status === "refining";
  const close = (
    <Button variant="link" size="sm" onClick={onClose}>
      Close
    </Button>
  );
  const staleNote = stale ? (
    <p className={styles.staleNote} role="status">
      Your settings changed after these were found. Optimize again to get options for them.
    </p>
  ) : null;
  const errorNote = state.error ? (
    <div className={styles.errorNote} role="alert">
      <p>Optimizing stopped before it finished: {state.error}</p>
      <Button variant="ghost" size="sm" onClick={(event) => onRetry(event.detail === 0)}>
        Try again
      </Button>
    </div>
  ) : null;

  if (!result) {
    if (!errorNote) return null;
    return (
      <section {...sectionProps}>
        <div className={styles.altHead}>
          <h2 id="alternatives-title">No schedules yet</h2>
          <span className={styles.spacer} />
          {close}
        </div>
        {errorNote}
      </section>
    );
  }

  if (result.status === "infeasible") {
    const { explanation } = result;
    return (
      <section {...sectionProps}>
        <div className={styles.altHead}>
          <h2 id="alternatives-title">Nothing fits these settings</h2>
          <span className={styles.spacer} />
          {close}
        </div>
        {staleNote}
        <div className={styles.explain} role="alert">
          <p className={styles.explainSentence}>{explanation.sentence}</p>
          {explanation.suggestions.length > 0 ? (
            <>
              <p className={styles.meta}>
                {explanation.suggestions.some((s) => s.resolves) ? "One change that makes it fit:" : "Changes to try:"}
              </p>
              <div className={styles.suggestions}>
                {explanation.suggestions.slice(0, 3).map((suggestion) => (
                  <Button
                    key={suggestion.label}
                    variant={suggestion.resolves ? "primary" : "ghost"}
                    size="sm"
                    disabled={stale}
                    onClick={() => onRelax(suggestion)}
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.meta}>
              No setting here causes it: these courses clash with each other. Take one of them another term, or check the official
              schedule for sections not in the sample data.
            </p>
          )}
        </div>
        {errorNote}
      </section>
    );
  }

  const standing = resultStanding(state);
  if (result.status === "timeout") {
    return (
      <section {...sectionProps}>
        <div className={styles.altHead}>
          <h2 id="alternatives-title">{refining ? "Still searching" : "No schedule found in time"}</h2>
          {refining ? <span className={styles.searching} aria-hidden="true" /> : null}
          <span className={styles.spacer} />
          {close}
        </div>
        <p className={styles.explainSentence} role="status">
          {standing}
        </p>
        {errorNote}
      </section>
    );
  }

  const unknownWalks = result.schedules.reduce((sum, schedule) => sum + schedule.breakdown.unknownWalks, 0);
  const oneCourseDiffers = differsInOneCourse(result, courseOrder.length);

  return (
    <section {...sectionProps} data-refining={refining ? "true" : "false"}>
      <div className={styles.altHead}>
        <h2 id="alternatives-title">
          {result.schedules.length === 1 ? "1 schedule fits" : `${result.schedules.length} schedules to compare`}
        </h2>
        {tag}
        <span className={styles.spacer} />
        {close}
      </div>
      <p className={styles.standing} role="status">
        {refining ? <span className={styles.searching} aria-hidden="true" /> : null}
        {standing}
      </p>
      {oneCourseDiffers ? <p className={styles.meta}>Only one course has other times, so these differ in one course.</p> : null}
      {unknownWalks > 0 ? (
        <p className={styles.meta}>
          Some walks here have no known time. Each counts as {UNKNOWN_WALK_MINUTES} minutes, an estimate, so the break may not be
          enough.
        </p>
      ) : null}
      {staleNote}
      {errorNote}
      <div
        className={styles.altGrid}
        onMouseLeave={() => onPreview(null, false)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreview(null, false);
        }}
      >
        {result.schedules.map((schedule, index) => {
          const letter = LETTERS[index];
          const moved = movedCourses(current, schedule.byCourse, find);
          const isCurrent = Object.entries(schedule.byCourse).every(([code, id]) => current[code] === id);
          const preview = (fromKeyboard: boolean) => onPreview(isCurrent || stale ? null : schedule, fromKeyboard);
          return (
            <article
              key={Object.values(schedule.byCourse).join("|")}
              className={styles.altCard}
              data-current={isCurrent ? "true" : "false"}
              data-stale={stale ? "true" : "false"}
              aria-label={`Option ${letter}`}
              onMouseEnter={() => {
                // Hover preview only where hover exists; touch gets it from focus.
                if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) preview(false);
              }}
              onFocus={(event) => preview((event.target as Element).matches(":focus-visible"))}
            >
              <div className={styles.altTitle}>
                <h3>Option {letter}</h3>
                <span className={styles.meta}>{index === 0 ? "Best match" : `#${index + 1}`}</span>
              </div>
              <MiniWeek
                events={eventsFor(schedule.byCourse, find)}
                courseOrder={courseOrder}
                moved={moved}
                label={`Option ${letter} week: ${schedule.breakdown.daysOnCampus} days on campus`}
              />
              <ul className={styles.srOnly} aria-label={`Option ${letter} classes`}>
                {meetingLines(schedule.byCourse, courseOrder, find).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Breakdown schedule={schedule} />
              <p className={styles.changed}>
                {isCurrent ? "This is your current schedule." : moved.length === 0 ? "Same times, other rooms or instructors." : `Moves ${moved.join(", ")}.`}
              </p>
              <Button
                variant={isCurrent ? "ghost" : "primary"}
                size="sm"
                disabled={isCurrent || stale}
                onClick={() => onUse(schedule, letter)}
              >
                {isCurrent ? "In use" : `Use option ${letter}`}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
