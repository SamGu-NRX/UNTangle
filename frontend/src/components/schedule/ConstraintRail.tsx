"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { TextField } from "@/components/ui/TextField";
import type { PreferencesStorage } from "@/components/planner-provider";
import { weekDays, type PreferenceWeights, type ScheduleConstraints, type SchedulePreferences, type WeekDay } from "@/lib/types";
import {
  applyChoice,
  choicesFromWeights,
  maxCreditOptions,
  parseBlockDraft,
  uniqueBlockId,
  type BlockDraft,
  type Choice,
  type Lean,
} from "./constraint-logic";
import styles from "./schedule.module.css";
import { clock } from "./week-model";

const WEIGHT_LABELS: Array<[keyof PreferenceWeights, string]> = [
  ["fewerDays", "Fewer days on campus"],
  ["compact", "Less idle time"],
  ["mornings", "Earlier classes"],
  ["evenings", "Later classes"],
  ["walking", "Less walking"],
  ["rating", "Higher-rated instructors"],
];

const WEIGHT_WORDS = ["Off", "Slight", "Some", "Strong", "Most"];

/** 7:00 AM .. 12:00 PM for the start, 12:00 PM .. 10:00 PM for the end, in 30-minute steps; the open end of each slider means "any time". */
const START_MIN = 7 * 60;
const START_MAX = 12 * 60;
const END_MIN = 12 * 60;
const END_MAX = 22 * 60;

const WALKING_OPTIONS = [
  { value: "0", label: "Fit the break" },
  { value: "5", label: "+5 min spare" },
  { value: "10", label: "+10 min spare" },
  { value: "off", label: "Don’t check" },
];

/**
 * The Week view's constraints: what to prefer (weights) and what must hold
 * (hard limits), then Optimize. On a phone it renders inside the
 * constraints sheet; `onOptimize` closes the sheet there.
 */
export function ConstraintRail({
  preferences,
  onChange,
  onOptimize,
  running,
  dirty,
  disabled,
  storage,
}: {
  preferences: SchedulePreferences;
  onChange: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  /** `fromKeyboard` runs show their result without animation. */
  onOptimize: (fromKeyboard: boolean) => void;
  running: boolean;
  dirty: boolean;
  /** True until the plan and the stored preferences have loaded. */
  disabled: boolean;
  storage: PreferencesStorage;
}) {
  const ids = useId();
  const { constraints, weights } = preferences;
  const choice = choicesFromWeights(weights);
  const setConstraints = (patch: Partial<ScheduleConstraints>) =>
    onChange((current) => ({ ...current, constraints: { ...current.constraints, ...patch } }));
  const choose = (next: Choice) => onChange((current) => ({ ...current, weights: applyChoice(current.weights, next) }));

  const [blockDraft, setBlockDraft] = useState<BlockDraft>({ label: "Work", day: "Tue", start: "13:00", end: "17:00" });
  const draft = parseBlockDraft(blockDraft, "draft");
  const fieldError = (field: "label" | "start" | "end") => (!draft.ok && draft.field === field ? draft.reason : null);

  return (
    <div className={styles.rail} aria-label="Schedule constraints" role="group">
      <section className={styles.railSection} aria-labelledby={`${ids}-prefer`}>
        <h2 className={styles.railHeading} id={`${ids}-prefer`}>
          Prefer
        </h2>
        <Segmented<Lean>
          label="Time of day"
          size="sm"
          fullWidth
          value={choice.lean}
          onValueChange={(lean) => choose({ lean })}
          options={[
            { value: "earlier", label: "Earlier", disabled },
            { value: "any", label: "Any", disabled },
            { value: "later", label: "Later", disabled },
          ]}
        />
        <ChipGroup label="Preferences">
          <Chip selected={choice.compact} disabled={disabled} onSelectedChange={(compact) => choose({ compact })}>
            Compact days
          </Chip>
          <Chip selected={choice.walks} disabled={disabled} onSelectedChange={(walks) => choose({ walks })}>
            Short walks
          </Chip>
          <Chip selected={choice.profs} disabled={disabled} onSelectedChange={(profs) => choose({ profs })}>
            Top-rated profs
          </Chip>
        </ChipGroup>
        <details className={styles.fineTune}>
          <summary>Fine-tune weights</summary>
          <div className={styles.fineTuneBody}>
            {WEIGHT_LABELS.map(([key, label]) => (
              <Slider
                key={key}
                label={label}
                min={0}
                max={4}
                step={1}
                ticks
                disabled={disabled}
                value={weights[key]}
                formatValue={(value) => WEIGHT_WORDS[value] ?? String(value)}
                onValueChange={(value) => onChange((current) => ({ ...current, weights: { ...current.weights, [key]: value } }))}
              />
            ))}
          </div>
        </details>
      </section>

      <section className={styles.railSection} aria-labelledby={`${ids}-limits`}>
        <h2 className={styles.railHeading} id={`${ids}-limits`}>
          Must have
        </h2>
        <Slider
          label="Classes start at or after"
          min={START_MIN}
          max={START_MAX}
          step={30}
          disabled={disabled}
          value={constraints.earliestStart ?? START_MIN}
          formatValue={(value) => (value === START_MIN ? "Any time" : clock(value, true))}
          onValueChange={(value) => setConstraints({ earliestStart: value === START_MIN ? null : value })}
        />
        <Slider
          label="Classes end by"
          min={END_MIN}
          max={END_MAX}
          step={30}
          disabled={disabled}
          value={constraints.latestEnd ?? END_MAX}
          formatValue={(value) => (value === END_MAX ? "Any time" : clock(value, true))}
          onValueChange={(value) => setConstraints({ latestEnd: value === END_MAX ? null : value })}
        />

        <span className={styles.subLabel} aria-hidden="true">
          Days off
        </span>
        <ChipGroup label="Days off">
          {weekDays.map((day) => {
            const off = constraints.daysOff.includes(day);
            return (
              <Chip
                key={day}
                size="sm"
                selected={off}
                disabled={disabled}
                onSelectedChange={() =>
                  onChange((current) => {
                    const days = current.constraints.daysOff;
                    return {
                      ...current,
                      constraints: { ...current.constraints, daysOff: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] },
                    };
                  })
                }
              >
                <span className={styles.srOnly}>No classes on </span>
                {day}
              </Chip>
            );
          })}
        </ChipGroup>

        <span className={styles.subLabel} aria-hidden="true">
          Sections to suggest
        </span>
        <ChipGroup label="Sections to suggest">
          <Chip size="sm" selected={constraints.openSeatsOnly} disabled={disabled} onSelectedChange={(openSeatsOnly) => setConstraints({ openSeatsOnly })}>
            Open seats only
          </Chip>
          <Chip size="sm" selected={constraints.otherSites} disabled={disabled} onSelectedChange={(otherSites) => setConstraints({ otherSites })}>
            Include other UNT sites
          </Chip>
        </ChipGroup>

        <fieldset className={styles.blockSet} disabled={disabled}>
          <legend className={styles.subLabel}>Keep a time free</legend>
          {constraints.blocked.length > 0 ? (
            <ul className={styles.blockList}>
              {constraints.blocked.map((block) => (
                <li key={block.id} className={styles.blockRow}>
                  <span>
                    <b>{block.label}</b> · {block.day} {clock(block.start, true)}–{clock(block.end, true)}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        constraints: { ...current.constraints, blocked: current.constraints.blocked.filter((entry) => entry.id !== block.id) },
                      }))
                    }
                  >
                    Remove<span className={styles.srOnly}> {block.label}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className={styles.blockForm}
            onSubmit={(event) => {
              event.preventDefault();
              onChange((current) => {
                const id = uniqueBlockId(current.constraints.blocked, `block-${Date.now().toString(36)}`);
                const parsed = parseBlockDraft(blockDraft, id);
                if (!parsed.ok) return current;
                return { ...current, constraints: { ...current.constraints, blocked: [...current.constraints.blocked, parsed.block] } };
              });
            }}
          >
            <TextField
              size="sm"
              label="Name"
              value={blockDraft.label}
              maxLength={24}
              error={fieldError("label")}
              onChange={(event) => setBlockDraft({ ...blockDraft, label: event.target.value })}
            />
            <Select
              size="sm"
              label="Day"
              value={blockDraft.day}
              options={weekDays.map((day) => ({ value: day, label: day }))}
              onValueChange={(day) => setBlockDraft({ ...blockDraft, day: day as WeekDay })}
            />
            <TextField
              size="sm"
              type="time"
              step={900}
              label="From"
              required
              value={blockDraft.start}
              error={fieldError("start")}
              onChange={(event) => setBlockDraft({ ...blockDraft, start: event.target.value })}
            />
            <TextField
              size="sm"
              type="time"
              step={900}
              label="Until"
              required
              value={blockDraft.end}
              error={fieldError("end")}
              onChange={(event) => setBlockDraft({ ...blockDraft, end: event.target.value })}
            />
            {/* Announces the missing piece; the visible text sits under the field it is about. */}
            <p className={styles.srOnly} aria-live="polite">
              {draft.ok ? "" : draft.reason}
            </p>
            <Button type="submit" variant="ghost" size="sm" disabled={!draft.ok}>
              Block time
            </Button>
          </form>
        </fieldset>

        <Select
          size="sm"
          label="Max credits"
          disabled={disabled}
          value={constraints.maxCredits === null ? "" : String(constraints.maxCredits)}
          options={[
            { value: "", label: "No limit" },
            ...maxCreditOptions(constraints.maxCredits).map((credits) => ({ value: String(credits), label: String(credits) })),
          ]}
          onValueChange={(value) => setConstraints({ maxCredits: value === "" ? null : Number(value) })}
        />

        <Select
          size="sm"
          label="Walks between buildings"
          disabled={disabled}
          value={constraints.walkingBufferMinutes === null ? "off" : String(constraints.walkingBufferMinutes)}
          options={
            WALKING_OPTIONS.some((option) => option.value === String(constraints.walkingBufferMinutes ?? "off"))
              ? WALKING_OPTIONS
              : [...WALKING_OPTIONS, { value: String(constraints.walkingBufferMinutes), label: `+${constraints.walkingBufferMinutes} min spare` }]
          }
          help="Walk times follow campus walkways. A walk with no known time counts as 10 minutes, an estimate."
          onValueChange={(value) => setConstraints({ walkingBufferMinutes: value === "off" ? null : Number(value) })}
        />
      </section>

      <div className={styles.optimizeRow}>
        <Button
          className={styles.full}
          onClick={(event) => onOptimize(event.detail === 0)}
          disabled={disabled}
          loading={running}
          loadingLabel="Optimizing…"
          aria-describedby={`${ids}-optimize-hint`}
        >
          Optimize week
        </Button>
        <p className={styles.meta} id={`${ids}-optimize-hint`}>
          {dirty ? "Shows three schedules to compare. Your plan changes only when you pick one." : "Up to date with these settings."}
        </p>
        {storage === "not-stored" ? (
          <p className={styles.meta} role="status">
            These settings are not stored in this browser, so they last only until this tab closes.
          </p>
        ) : storage === "rebased" ? (
          <p className={styles.meta} role="status">
            Another tab changed these settings first; your change was added to its version.
          </p>
        ) : null}
      </div>
    </div>
  );
}
