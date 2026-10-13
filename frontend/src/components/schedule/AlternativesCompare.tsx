"use client";

import type { OptimizeResult, RankedSchedule, RelaxSuggestion } from "@/lib/optimizer/types";
import styles from "./schedule.module.css";
import { MiniWeek } from "./WeekGrid";
import { clock, eventsFor, movedCourses } from "./week-model";

const LETTERS = ["A", "B", "C", "D", "E"];

function minutesText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

function Breakdown({ schedule }: { schedule: RankedSchedule }) {
  const b = schedule.breakdown;
  const walk = Math.round(b.walkSeconds / 60);
  return (
    <dl className={styles.breakdown}>
      <dt>Days on campus</dt>
      <dd>{b.daysOnCampus}</dd>
      <dt>Time between classes</dt>
      <dd>{minutesText(b.gapMinutes)} / wk</dd>
      <dt>Walking</dt>
      <dd>
        {walk} min / wk{b.unknownWalks > 0 ? ` + ${b.unknownWalks} unknown` : ""}
      </dd>
      <dt>Earliest – latest</dt>
      <dd>
        {b.earliestStart === null || b.latestEnd === null ? "—" : `${clock(b.earliestStart)}–${clock(b.latestEnd)}`}
      </dd>
    </dl>
  );
}

export function AlternativesCompare({
  result,
  current,
  courseOrder,
  onUse,
  onPreview,
  onRelax,
  onClose,
}: {
  result: OptimizeResult;
  current: Record<string, string>;
  courseOrder: string[];
  onUse: (schedule: RankedSchedule, letter: string) => void;
  onPreview: (schedule: RankedSchedule | null) => void;
  onRelax: (suggestion: RelaxSuggestion) => void;
  onClose: () => void;
}) {
  if (result.status === "infeasible") {
    const { explanation } = result;
    return (
      <section className={styles.alternatives} aria-labelledby="alternatives-title" role="region">
        <div className={styles.altHead}>
          <h2 id="alternatives-title">Nothing fits these settings</h2>
          <span className={styles.spacer} />
          <button type="button" className={styles.linkButton} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.explain} role="alert">
          <p className={styles.explainSentence}>{explanation.sentence}</p>
          {explanation.suggestions.length > 0 ? (
            <>
              <p className={styles.meta} style={{ margin: 0 }}>
                {explanation.suggestions.some((s) => s.resolves) ? "One change that makes it fit:" : "Changes to try:"}
              </p>
              <div className={styles.suggestions}>
                {explanation.suggestions.slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    className={`${styles.button} ${suggestion.resolves ? styles.primary : styles.ghost} ${styles.small}`}
                    onClick={() => onRelax(suggestion)}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.meta} style={{ margin: 0 }}>
              No setting here causes it: these courses clash with each other. Take one of them another term, or check the
              official schedule for sections not in the sample data.
            </p>
          )}
        </div>
      </section>
    );
  }

  if (result.status === "timeout") {
    return (
      <section className={styles.alternatives} aria-labelledby="alternatives-title" role="region">
        <div className={styles.altHead}>
          <h2 id="alternatives-title">Still searching</h2>
          <span className={styles.spacer} />
          <button type="button" className={styles.linkButton} onClick={onClose}>
            Close
          </button>
        </div>
        <p className={styles.explainSentence} role="status">
          No schedule turned up within the time limit, and none was ruled out. Loosen a setting or lock a section, then try again.
        </p>
      </section>
    );
  }

  const proven = result.status === "optimal";
  return (
    <section className={styles.alternatives} aria-labelledby="alternatives-title" role="region">
      <div className={styles.altHead}>
        <h2 id="alternatives-title">
          {result.schedules.length === 1 ? "1 schedule fits" : `${result.schedules.length} schedules to compare`}
        </h2>
        <span className={styles.tag}>Sample</span>
        <span className={styles.meta} role="status">
          {proven
            ? result.schedules.length < 3
              ? "Best possible; no other schedule differs enough to show."
              : "Ranked by your preferences; each is the best of its kind."
            : "Best found within the time limit; a better one may exist."}
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.linkButton} onClick={onClose}>
          Close
        </button>
      </div>
      <div
        className={styles.altGrid}
        onMouseLeave={() => onPreview(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreview(null);
        }}
      >
        {result.schedules.map((schedule, index) => {
          const letter = LETTERS[index];
          const moved = movedCourses(current, schedule.byCourse);
          const isCurrent = Object.entries(schedule.byCourse).every(([code, id]) => current[code] === id);
          return (
            <article
              key={Object.values(schedule.byCourse).join("|")}
              className={styles.altCard}
              data-current={isCurrent ? "true" : "false"}
              aria-label={`Option ${letter}`}
              onMouseEnter={() => {
                // Hover preview only where hover exists; touch gets it from focus.
                if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) onPreview(isCurrent ? null : schedule);
              }}
              onFocus={() => onPreview(isCurrent ? null : schedule)}
            >
              <div className={styles.altTitle}>
                <h3>Option {letter}</h3>
                <span className={styles.meta}>{index === 0 ? "Best match" : `#${index + 1}`}</span>
              </div>
              <MiniWeek
                events={eventsFor(schedule.byCourse)}
                courseOrder={courseOrder}
                moved={moved}
                label={`Option ${letter} week: ${schedule.breakdown.daysOnCampus} days on campus`}
              />
              <Breakdown schedule={schedule} />
              <p className={styles.changed}>
                {isCurrent ? "This is your current schedule." : moved.length === 0 ? "Same times, other rooms or instructors." : `Moves ${moved.join(", ")}.`}
              </p>
              <button
                type="button"
                className={`${styles.button} ${isCurrent ? styles.ghost : styles.primary} ${styles.small}`}
                disabled={isCurrent}
                onClick={() => onUse(schedule, letter)}
              >
                {isCurrent ? "In use" : `Use option ${letter}`}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
