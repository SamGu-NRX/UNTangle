"use client";

import { useId, useState } from "react";
import { weekDays, type PreferenceWeights, type ScheduleConstraints, type SchedulePreferences, type WeekDay } from "@/lib/types";
import styles from "./schedule.module.css";
import { clock } from "./week-model";

type Lean = "earlier" | "any" | "later";

const DAY_NAMES: Record<WeekDay, string> = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri" };

/**
 * The preference chips are the five goals and their mixes: each chip turns
 * one weight up to 4, and with "Compact days" off a light idle-time weight
 * (1) breaks ties, exactly as the goal presets in optimizer/presets.ts do.
 */
export function weightsFromChoices(choice: { lean: Lean; compact: boolean; walks: boolean; profs: boolean }): PreferenceWeights {
  return {
    mornings: choice.lean === "earlier" ? 4 : 0,
    evenings: choice.lean === "later" ? 4 : 0,
    compact: choice.compact ? 4 : 1,
    fewerDays: choice.compact ? 2 : 0,
    walking: choice.walks ? 4 : 0,
    rating: choice.profs ? 4 : 0,
  };
}

export function choicesFromWeights(w: PreferenceWeights) {
  return {
    lean: (w.mornings > w.evenings ? "earlier" : w.evenings > w.mornings ? "later" : "any") as Lean,
    compact: w.compact >= 3 || w.fewerDays >= 2,
    walks: w.walking >= 3,
    profs: w.rating >= 3,
  };
}

const WEIGHT_LABELS: Array<[keyof PreferenceWeights, string]> = [
  ["fewerDays", "Fewer days on campus"],
  ["compact", "Less idle time"],
  ["mornings", "Earlier classes"],
  ["evenings", "Later classes"],
  ["walking", "Less walking"],
  ["rating", "Higher-rated instructors"],
];

function Segmented({ value, onChange, label }: { value: Lean; onChange: (lean: Lean) => void; label: string }) {
  const options: Array<[Lean, string]> = [
    ["earlier", "Earlier"],
    ["any", "Any"],
    ["later", "Later"],
  ];
  const index = options.findIndex(([key]) => key === value);
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      <span className={styles.segmentPill} style={{ width: "calc((100% - 4px) / 3)", transform: `translateX(${index * 100}%)` }} />
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          tabIndex={value === key ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(key)}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const next = options[(index + step + options.length) % options.length][0];
            onChange(next);
            const group = event.currentTarget.parentElement;
            requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Chip({ pressed, onToggle, children }: { pressed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={styles.chip} aria-pressed={pressed} onClick={onToggle}>
      {children}
    </button>
  );
}

/** 7:00 AM .. 12:00 PM for the start, 12:00 PM .. 10:00 PM for the end, in 30-minute steps; the end of each slider means "any". */
const START_MIN = 7 * 60;
const START_MAX = 12 * 60;
const END_MIN = 12 * 60;
const END_MAX = 22 * 60;

export function ConstraintRail({
  preferences,
  onChange,
  onOptimize,
  running,
  dirty,
}: {
  preferences: SchedulePreferences;
  onChange: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  onOptimize: () => void;
  running: boolean;
  dirty: boolean;
}) {
  const ids = useId();
  const { constraints, weights } = preferences;
  const choice = choicesFromWeights(weights);
  const setConstraints = (patch: Partial<ScheduleConstraints>) =>
    onChange((current) => ({ ...current, constraints: { ...current.constraints, ...patch } }));
  const setChoice = (patch: Partial<typeof choice>) =>
    onChange((current) => ({ ...current, weights: weightsFromChoices({ ...choicesFromWeights(current.weights), ...patch }) }));

  const [blockDraft, setBlockDraft] = useState({ label: "Work", day: "Tue" as WeekDay, start: "13:00", end: "17:00" });
  const toMin = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const draftValid = blockDraft.label.trim().length > 0 && toMin(blockDraft.end) > toMin(blockDraft.start);

  const startValue = constraints.earliestStart ?? START_MIN;
  const endValue = constraints.latestEnd ?? END_MAX;

  return (
    <aside className={styles.rail} aria-label="Schedule constraints">
      <section className={styles.railSection} aria-labelledby={`${ids}-prefer`}>
        <h2 className={styles.railHeading} id={`${ids}-prefer`}>
          Prefer
        </h2>
        <Segmented label="Time of day" value={choice.lean} onChange={(lean) => setChoice({ lean })} />
        <div className={styles.chips}>
          <Chip pressed={choice.compact} onToggle={() => setChoice({ compact: !choice.compact })}>
            Compact days
          </Chip>
          <Chip pressed={choice.walks} onToggle={() => setChoice({ walks: !choice.walks })}>
            Short walks
          </Chip>
          <Chip pressed={choice.profs} onToggle={() => setChoice({ profs: !choice.profs })}>
            Top-rated profs
          </Chip>
        </div>
        <details>
          <summary className={styles.linkButton} style={{ cursor: "pointer" }}>
            Fine-tune weights
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {WEIGHT_LABELS.map(([key, label]) => (
              <label key={key} style={{ display: "grid", gap: 2 }}>
                <span className={styles.subLabel}>
                  {label} <b>{weights[key]}</b>
                </span>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={weights[key]}
                  onChange={(event) =>
                    onChange((current) => ({ ...current, weights: { ...current.weights, [key]: Number(event.target.value) } }))
                  }
                />
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className={styles.railSection} aria-labelledby={`${ids}-limits`}>
        <h2 className={styles.railHeading} id={`${ids}-limits`}>
          Must have
        </h2>
        <label style={{ display: "grid", gap: 2 }}>
          <span className={styles.subLabel}>
            Classes start at or after <b>{constraints.earliestStart === null ? "any time" : clock(constraints.earliestStart, true)}</b>
          </span>
          <input
            className={styles.range}
            type="range"
            min={START_MIN}
            max={START_MAX}
            step={30}
            value={startValue}
            aria-valuetext={constraints.earliestStart === null ? "Any time" : clock(constraints.earliestStart, true)}
            onChange={(event) => {
              const value = Number(event.target.value);
              setConstraints({ earliestStart: value === START_MIN ? null : value });
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 2 }}>
          <span className={styles.subLabel}>
            Classes end by <b>{constraints.latestEnd === null ? "any time" : clock(constraints.latestEnd, true)}</b>
          </span>
          <input
            className={styles.range}
            type="range"
            min={END_MIN}
            max={END_MAX}
            step={30}
            value={endValue}
            aria-valuetext={constraints.latestEnd === null ? "Any time" : clock(constraints.latestEnd, true)}
            onChange={(event) => {
              const value = Number(event.target.value);
              setConstraints({ latestEnd: value === END_MAX ? null : value });
            }}
          />
        </label>

        <span className={styles.subLabel}>Days off</span>
        <div className={styles.chips} role="group" aria-label="Days off">
          {weekDays.map((day) => {
            const off = constraints.daysOff.includes(day);
            return (
              <Chip
                key={day}
                pressed={off}
                onToggle={() =>
                  setConstraints({ daysOff: off ? constraints.daysOff.filter((d) => d !== day) : [...constraints.daysOff, day] })
                }
              >
                <span className={styles.srOnly}>No classes on </span>
                {DAY_NAMES[day]}
              </Chip>
            );
          })}
        </div>

        <span className={styles.subLabel}>Blocked times</span>
        {constraints.blocked.map((block) => (
          <div key={block.id} className={styles.blockRow}>
            <span>
              <b>{block.label}</b> · {block.day} {clock(block.start, true)}–{clock(block.end, true)}
            </span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setConstraints({ blocked: constraints.blocked.filter((entry) => entry.id !== block.id) })}
            >
              Remove<span className={styles.srOnly}> {block.label}</span>
            </button>
          </div>
        ))}
        <form
          className={styles.blockForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!draftValid) return;
            const id = `block-${Date.now().toString(36)}`;
            setConstraints({
              blocked: [
                ...constraints.blocked,
                { id, label: blockDraft.label.trim(), day: blockDraft.day, start: toMin(blockDraft.start), end: toMin(blockDraft.end) },
              ],
            });
          }}
        >
          <input
            className={styles.field}
            aria-label="Blocked time name"
            value={blockDraft.label}
            maxLength={24}
            onChange={(event) => setBlockDraft({ ...blockDraft, label: event.target.value })}
          />
          <select
            className={styles.field}
            aria-label="Blocked day"
            value={blockDraft.day}
            onChange={(event) => setBlockDraft({ ...blockDraft, day: event.target.value as WeekDay })}
          >
            {weekDays.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <input
            className={styles.field}
            type="time"
            step={900}
            aria-label="Blocked from"
            value={blockDraft.start}
            onChange={(event) => setBlockDraft({ ...blockDraft, start: event.target.value })}
          />
          <input
            className={styles.field}
            type="time"
            step={900}
            aria-label="Blocked until"
            value={blockDraft.end}
            onChange={(event) => setBlockDraft({ ...blockDraft, end: event.target.value })}
          />
          <button type="submit" className={`${styles.button} ${styles.ghost} ${styles.small}`} disabled={!draftValid}>
            Block time
          </button>
        </form>

        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className={styles.subLabel}>Max credits</span>
          <select
            className={styles.field}
            value={constraints.maxCredits ?? ""}
            onChange={(event) => setConstraints({ maxCredits: event.target.value === "" ? null : Number(event.target.value) })}
          >
            <option value="">No limit</option>
            {Array.from({ length: 19 }, (_, i) => i + 3).map((credits) => (
              <option key={credits} value={credits}>
                {credits}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className={styles.subLabel}>Walks between buildings</span>
          <select
            className={styles.field}
            value={constraints.walkingBufferMinutes === null ? "off" : String(constraints.walkingBufferMinutes)}
            onChange={(event) =>
              setConstraints({ walkingBufferMinutes: event.target.value === "off" ? null : Number(event.target.value) })
            }
          >
            <option value="0">Fits the break</option>
            <option value="5">+5 min spare</option>
            <option value="10">+10 min spare</option>
            <option value="off">Don&rsquo;t check</option>
          </select>
        </label>
      </section>

      <button
        type="button"
        className={`${styles.button} ${styles.primary} ${styles.full}`}
        onClick={onOptimize}
        disabled={running}
        aria-describedby={`${ids}-optimize-hint`}
      >
        {running ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {running ? "Optimizing…" : "Optimize week"}
      </button>
      <p className={styles.meta} id={`${ids}-optimize-hint`} style={{ margin: "-12px 0 0" }}>
        {dirty ? "Shows three schedules to compare. Your plan changes only when you pick one." : "Up to date with these settings."}
      </p>
    </aside>
  );
}
