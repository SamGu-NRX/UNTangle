"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Close } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { TextField } from "@/components/ui/TextField";
import type { SchedulePreferences, WeekDay } from "@/lib/types";
import styles from "./builder.module.css";
import {
  addBusy,
  busyGroups,
  busyLabel,
  fewerDays,
  hasLunch,
  MOST_CREDITS,
  removeBusy,
  shortWalks,
  START_AFTER,
  topRated,
  WEEKDAYS,
  withFewerDays,
  withLunch,
  withShortWalks,
  withTopRated,
} from "./preferences";

type Props = {
  preferences: SchedulePreferences;
  defaults: SchedulePreferences;
  onChange: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  /** Fine pointers can also drag on the grid; the form is for everyone else. */
  canDraw: boolean;
};

const startLabel = (value: number | null) => (value === null ? "Any time" : `${value / 60} AM`);
const toMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

let busyIds = 0;
export const newBusyId = () => `busy-${Date.now().toString(36)}-${(busyIds += 1)}`;

/** Week's preferences (03-untangle-prefs-desk.png): every choice visible at once, no dropdowns. */
export function PreferencesPanel({ preferences: p, defaults, onChange, canDraw }: Props) {
  const c = p.constraints;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("Work");
  const [days, setDays] = useState<WeekDay[]>([]);
  const [from, setFrom] = useState("15:00");
  const [to, setTo] = useState("17:00");
  const start = toMinutes(from);
  const end = toMinutes(to);
  // Checked on Add, not before: a disabled button can't say what's missing.
  const [checked, setChecked] = useState(false);
  const problems = {
    name: name.trim() === "" ? "Give it a name, such as Work." : null,
    days: days.length === 0 ? "Pick at least one day." : null,
    from: start === null ? "Enter a start time." : null,
    to: end === null ? "Enter an end time." : start !== null && end <= start ? "Ends before it starts." : null,
  };
  const shown = checked ? problems : { name: null, days: null, from: null, to: problems.to === "Ends before it starts." ? problems.to : null };

  return (
    <div className={styles.prefs}>
      <p className={styles.meta}>Auto follows these. Most weeks need none.</p>

      <section className={styles.prefSection} aria-labelledby="pref-start">
        <h3 id="pref-start" className={styles.label}>
          Start after
        </h3>
        <Segmented
          label="Start after"
          size="sm"
          fullWidth
          options={START_AFTER.map((value) => ({ value: String(value), label: startLabel(value) }))}
          value={String(c.earliestStart)}
          onValueChange={(value) => onChange((q) => ({ ...q, constraints: { ...q.constraints, earliestStart: value === "null" ? null : Number(value) } }))}
        />
      </section>

      <section className={styles.prefSection} aria-labelledby="pref-off">
        <h3 id="pref-off" className={styles.label}>
          Days off
        </h3>
        <div className={styles.chips} role="group" aria-labelledby="pref-off">
          {WEEKDAYS.map((day) => (
            <Chip
              key={day}
              selected={c.daysOff.includes(day)}
              onSelectedChange={(on) =>
                onChange((q) => ({
                  ...q,
                  constraints: { ...q.constraints, daysOff: on ? WEEKDAYS.filter((d) => d === day || q.constraints.daysOff.includes(d)) : q.constraints.daysOff.filter((d) => d !== day) },
                }))
              }
            >
              {day}
            </Chip>
          ))}
        </div>
      </section>

      <section className={styles.prefSection} aria-labelledby="pref-prefer">
        <h3 id="pref-prefer" className={styles.label}>
          Prefer
        </h3>
        <div className={styles.chips} role="group" aria-labelledby="pref-prefer">
          <Chip selected={shortWalks(p)} onSelectedChange={(on) => onChange((q) => withShortWalks(q, on, defaults))}>
            Short walks
          </Chip>
          <Chip selected={hasLunch(p)} onSelectedChange={(on) => onChange((q) => withLunch(q, on))}>
            Lunch break
          </Chip>
          <Chip selected={fewerDays(p)} onSelectedChange={(on) => onChange((q) => withFewerDays(q, on))}>
            Fewer days
          </Chip>
          <Chip selected={topRated(p)} onSelectedChange={(on) => onChange((q) => withTopRated(q, on))}>
            Top-rated profs
          </Chip>
        </div>
      </section>

      <section className={styles.prefSection} aria-labelledby="pref-credits">
        <h3 id="pref-credits" className={styles.label}>
          Most credits
        </h3>
        <Segmented
          label="Most credits"
          size="sm"
          fullWidth
          options={MOST_CREDITS.map((value) => ({ value: String(value), label: value === null ? "No limit" : String(value) }))}
          value={String(c.maxCredits)}
          onValueChange={(value) => onChange((q) => ({ ...q, constraints: { ...q.constraints, maxCredits: value === "null" ? null : Number(value) } }))}
        />
      </section>

      <section className={styles.prefSection} aria-labelledby="pref-suggest">
        <h3 id="pref-suggest" className={styles.label}>
          Sections Auto suggests
        </h3>
        <Switch
          checked={c.openSeatsOnly}
          onChange={(on) => onChange((q) => ({ ...q, constraints: { ...q.constraints, openSeatsOnly: on } }))}
          label="Open seats only"
          description="Full and wait-listed sections stay pickable by hand."
        />
        <Switch
          checked={c.otherSites}
          onChange={(on) => onChange((q) => ({ ...q, constraints: { ...q.constraints, otherSites: on } }))}
          label="Include other UNT sites"
          description="Frisco and other campuses outside Denton. Discovery Park counts as Denton."
        />
      </section>

      <section className={styles.prefSection} aria-labelledby="pref-busy">
        <h3 id="pref-busy" className={styles.label}>
          Busy times
        </h3>
        {busyGroups(p).length > 0 ? (
          <ul className={styles.busyList}>
            {busyGroups(p).map((group) => (
              <li key={group.ids.join()} className={styles.busyRow}>
                {busyLabel(group)}
                <IconButton label={`Remove ${group.label}`} size="sm" onClick={() => onChange((q) => removeBusy(q, group.ids))}>
                  <Close size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        {canDraw ? <p className={styles.meta}>Drag across empty time on the grid to add one.</p> : null}
        {adding ? (
          <form
            className={styles.busyForm}
            onSubmit={(event) => {
              event.preventDefault();
              setChecked(true);
              const first = (["name", "days", "from", "to"] as const).find((field) => problems[field]);
              if (first) {
                event.currentTarget.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] button`)?.focus();
                return;
              }
              const label = name.trim();
              onChange((q) => days.reduce((acc, day) => addBusy(acc, { label, day, start: start!, end: end! }, newBusyId()), q));
              setAdding(false);
              setDays([]);
              setChecked(false);
            }}
          >
            <div data-field="name">
              <TextField label="Name" size="sm" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" error={shown.name} />
            </div>
            <div className={styles.chips} role="group" aria-label="Days" aria-describedby={shown.days ? "busy-days-error" : undefined} data-field="days">
              {WEEKDAYS.map((day) => (
                <Chip key={day} size="sm" selected={days.includes(day)} onSelectedChange={(on) => setDays(on ? WEEKDAYS.filter((d) => d === day || days.includes(d)) : days.filter((d) => d !== day))}>
                  {day}
                </Chip>
              ))}
            </div>
            {shown.days ? (
              <p id="busy-days-error" className={styles.fieldError} role="alert">
                {shown.days}
              </p>
            ) : null}
            <div className={styles.timeRow}>
              <div data-field="from">
                <TextField label="From" size="sm" type="time" step={900} value={from} onChange={(event) => setFrom(event.target.value)} error={shown.from} />
              </div>
              <div data-field="to">
                <TextField label="To" size="sm" type="time" step={900} value={to} onChange={(event) => setTo(event.target.value)} error={shown.to} />
              </div>
            </div>
            <div className={styles.actions}>
              <Button type="submit" size="sm">
                Add
              </Button>
              <Button type="button" size="sm" variant="quiet" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" size="sm" className={styles.start} onClick={() => setAdding(true)}>
            Add a busy time
          </Button>
        )}
      </section>

      <div className={styles.actions}>
        <Button variant="quiet" size="sm" className={styles.start} onClick={() => onChange(() => defaults)}>
          Back to defaults
        </Button>
      </div>
    </div>
  );
}
