"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { CalendarGlyph, Check, Close, LockGlyph, Plus } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Switch } from "@/components/ui/Switch";
import { TextField } from "@/components/ui/TextField";
import { toast } from "@/components/ui/Toast";
import { busyCount, eventBusyTime, MAX_CALENDARS, type CheckedFeed, type FeedEvent, type FeedProblem } from "@/lib/calendar-busy";
import type { ConnectedCalendar, SchedulePreferences } from "@/lib/types";
import type { BuilderCalendars } from "./host";
import { shortDate } from "./limits";
import { clockWithSuffix } from "./week";
import styles from "./prefs.module.css";

type Update = (update: (current: SchedulePreferences) => SchedulePreferences) => void;

/**
 * Connecting a calendar, step by step. The address lives only in this state
 * while the student works; what is saved is the sealed calendar the host
 * returns.
 */
type Flow =
  | { step: "closed" }
  | { step: "address"; url: string; error: string | null; checking: boolean }
  | {
      step: "checked";
      url: string;
      feed: CheckedFeed;
      name: string;
      /** Count the feed's all-day events as busy. Off by default: they are mostly deadlines, holidays and reminders. */
      countAllDay: boolean;
      error: string | null;
      adding: boolean;
      picking: boolean;
      query: string;
    };

/** How many events the one-event list shows before asking for a search. */
const EVENTS_SHOWN = 30;

/** "11 AM to 12:30 PM": a range the way people say it (docs/design/copy.md). */
const spokenSpan = (start: number, end: number) => `${clockWithSuffix(start)} to ${clockWithSuffix(end)}`;

/** "It works. 36 busy times in Spring 2027; 4 all-day events skipped." */
function foundLine(feed: CheckedFeed, countAllDay: boolean, termLabel: string): string {
  const timed = feed.busyCount === 0 ? `Nothing busy in ${termLabel} yet` : `${plural(feed.busyCount, "busy time")} in ${termLabel}`;
  if (feed.allDayEvents === 0) return `It works. ${timed}.`;
  return `It works. ${timed}; ${plural(feed.allDayEvents, "all-day event")} ${countAllDay ? "counted" : "skipped"}.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A check or connect that threw: a bug, not something the student did. The
 * form says so and stays usable rather than spinning; the log line names the
 * error only, never the address.
 */
function failed(error: unknown): { ok: false; problem: FeedProblem } {
  console.error("Calendar check or connect failed", error instanceof Error ? error.name : typeof error);
  return { ok: false, problem: { kind: "unreachable", message: "That calendar couldn't be read. Try again." } };
}

function withoutCalendar(p: SchedulePreferences, id: string): SchedulePreferences {
  const calendars = (p.calendars ?? []).filter((calendar) => calendar.id !== id);
  // Absent, not empty, when none are left: the preferences document's canonical form.
  const rest = Object.fromEntries(Object.entries(p).filter(([key]) => key !== "calendars")) as SchedulePreferences;
  return calendars.length ? { ...rest, calendars } : rest;
}

/** One connected calendar: its name, what it holds this term, and Remove. */
function CalendarRow({
  calendar,
  term,
  problem,
  onRemove,
  onCountAllDay,
}: {
  calendar: ConnectedCalendar;
  term: BuilderCalendars["term"];
  problem: string | undefined;
  onRemove: () => void;
  onCountAllDay: (on: boolean) => void;
}) {
  const n = busyCount(calendar) + (calendar.countAllDay ? calendar.allDayDates.length : 0);
  const fact = problem
    ? problem
    : calendar.termId !== term.id
      ? `Reading ${term.label}`
      : n === 0
        ? `Nothing busy in ${term.label}`
        : `${plural(n, "busy time")} in ${term.label}`;
  return (
    <li data-kind="calendar">
      <span className={styles.rowIcon}>
        <CalendarGlyph size={16} />
      </span>
      <span className={styles.rowText}>
        <b className={styles.rowName}>{calendar.name}</b>
        <span data-over={problem ? "" : undefined}>{fact}</span>
      </span>
      <IconButton label={`Remove ${calendar.name}`} size="sm" className={styles.rowX} onClick={onRemove}>
        <Close size={14} />
      </IconButton>
      {calendar.allDayDates.length > 0 ? (
        <Switch
          className={styles.rowSwitch}
          checked={calendar.countAllDay}
          onChange={onCountAllDay}
          label={`Count all-day events as busy`}
          description={`${plural(calendar.allDayDates.length, "all-day date")} in ${term.label}`}
        />
      ) : null}
    </li>
  );
}

/** The one-event list: pick an event and it becomes a busy time on its date only. */
function EventList({ events, query, onQuery, blocked, onPick }: { events: readonly FeedEvent[]; query: string; onQuery: (q: string) => void; blocked: ReadonlySet<string>; onPick: (event: FeedEvent) => void }) {
  if (events.length === 0) return <p className={styles.srowEmpty}>No timed weekday events this term.</p>;
  const q = query.trim().toLowerCase();
  const matching = q ? events.filter((event) => event.summary.toLowerCase().includes(q)) : events;
  const shown = matching.slice(0, EVENTS_SHOWN);
  return (
    <div className={styles.eventPick}>
      {events.length > 8 ? (
        <TextField
          size="sm"
          label="Find an event"
          hideLabel
          placeholder="Find an event"
          value={query}
          autoComplete="off"
          onChange={(e) => onQuery(e.target.value)}
          // Enter searches; it must not submit the surrounding form and add the whole calendar.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      ) : null}
      <div className={styles.eventList} role="group" aria-label="Events">
        {shown.map((event) => {
          const added = blocked.has(eventBusyTime(event).id);
          return (
            <button key={event.key} type="button" className={styles.opt} disabled={added} onClick={() => onPick(event)}>
              <span className={styles.rowText}>
                <b className={styles.rowName}>{event.summary}</b>
                <span>
                  {event.day} {shortDate(event.date)}, {spokenSpan(event.start, event.end)}
                </span>
              </span>
              <span className={styles.optTag}>{added ? "Added" : ""}</span>
            </button>
          );
        })}
      </div>
      {matching.length === 0 ? <p className={styles.srowEmpty}>No event matches that.</p> : null}
      {matching.length > shown.length ? <p className={styles.srowEmpty}>Type to find the other {matching.length - shown.length}.</p> : null}
    </div>
  );
}

/**
 * Calendars as busy time (Preferences, under the times you can't have
 * class). Paste a feed's address, check it, name it and add it; or turn one
 * of its events into a busy time on that date. Auto keeps every connected
 * calendar's busy dates free, and removing a calendar removes them.
 */
export function CalendarFeeds({ host, preferences, onChange }: { host: BuilderCalendars; preferences: SchedulePreferences; onChange: Update }) {
  const calendars = preferences.calendars ?? [];
  const [flow, setFlow] = useState<Flow>({ step: "closed" });
  // The picker and new rows slide in from a pointer; from the keyboard they appear at once (MOTION.md §3).
  const [instant, setInstant] = useState(false);
  const note = () => setInstant(keyboardFocused());
  // Async checks compare against the flow as it is when they finish, not as it was when they started.
  const flowRef = useRef(flow);
  useLayoutEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  const pickerId = useId();
  const addressRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const full = calendars.length >= MAX_CALENDARS;
  const term = host.term;
  const blocked = new Set(preferences.constraints.blocked.map((block) => block.id));

  // Focus follows the step: the address field when the picker opens, the name once the feed checks out.
  const step = flow.step;
  useEffect(() => {
    if (step === "address") addressRef.current?.focus({ preventScroll: keyboardFocused() });
    if (step === "checked") nameRef.current?.focus({ preventScroll: true });
  }, [step]);

  const close = () => {
    setFlow({ step: "closed" });
    addButton.current?.focus();
  };

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (flow.step !== "address" || flow.checking) return;
    note();
    const url = flow.url;
    setFlow({ ...flow, checking: true, error: null });
    const outcome = await host.check(url).catch(failed);
    // The student may have closed the picker or changed the address while it was checked.
    const now = flowRef.current;
    if (now.step !== "address" || now.url !== url) return;
    if (!outcome.ok) {
      setFlow({ ...now, checking: false, error: outcome.problem.message });
      addressRef.current?.focus();
      return;
    }
    setFlow({ step: "checked", url, feed: outcome.value, name: "", countAllDay: false, error: null, adding: false, picking: false, query: "" });
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (flow.step !== "checked" || flow.adding) return;
    note();
    const { url, name, countAllDay } = flow;
    setFlow({ ...flow, adding: true, error: null });
    const outcome = await host.connect(url, name.trim() || "Calendar", { countAllDay }).catch(failed);
    const now = flowRef.current;
    if (now.step !== "checked" || now.url !== url) return;
    if (!outcome.ok) {
      setFlow({ ...now, adding: false, error: outcome.problem.message });
      return;
    }
    const calendar = outcome.value;
    onChange((p) => ({ ...p, calendars: [...(p.calendars ?? []).filter((c) => c.id !== calendar.id), calendar] }));
    setFlow({ step: "closed" });
    addButton.current?.focus({ preventScroll: true });
    toast({
      message: `Added ${calendar.name}. Auto keeps its busy times free.`,
      action: { label: "Undo", onClick: () => onChange((p) => withoutCalendar(p, calendar.id)) },
    });
  };

  const pickEvent = (picked: FeedEvent) => {
    const block = eventBusyTime(picked);
    onChange((p) =>
      p.constraints.blocked.some((b) => b.id === block.id) ? p : { ...p, constraints: { ...p.constraints, blocked: [...p.constraints.blocked, block] } },
    );
    setFlow({ step: "closed" });
    addButton.current?.focus({ preventScroll: true });
    toast({
      message: `Added ${block.label} on ${shortDate(picked.date)}. Auto keeps that time free.`,
      action: {
        label: "Undo",
        onClick: () => onChange((p) => ({ ...p, constraints: { ...p.constraints, blocked: p.constraints.blocked.filter((b) => b.id !== block.id) } })),
      },
    });
  };

  const remove = (calendar: ConnectedCalendar) => {
    const index = calendars.findIndex((c) => c.id === calendar.id);
    onChange((p) => withoutCalendar(p, calendar.id));
    // The row and its button go away; focus lands on the section's own action instead of the page,
    // after the render that re-enables it when the list was full.
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
    toast({
      message: `Removed ${calendar.name}`,
      action: {
        label: "Undo",
        onClick: () =>
          onChange((p) => {
            const now = p.calendars ?? [];
            if (now.some((c) => c.id === calendar.id)) return p;
            return { ...p, calendars: [...now.slice(0, index), calendar, ...now.slice(index)] };
          }),
      },
    });
  };

  return (
    <div className={styles.feeds}>
      <div className={styles.subHead}>
        <span id={`${pickerId}-head`}>Your calendars</span>
        <button
          ref={addButton}
          type="button"
          className={styles.add}
          aria-expanded={flow.step !== "closed"}
          aria-controls={flow.step !== "closed" ? pickerId : undefined}
          disabled={full && flow.step === "closed"}
          onClick={() => {
            note();
            if (flow.step === "closed") setFlow({ step: "address", url: "", error: null, checking: false });
            else close();
          }}
        >
          <Plus size={14} />
          Add a calendar
        </button>
      </div>
      {calendars.length === 0 ? (
        flow.step === "closed" ? <p className={styles.srowEmpty}>None yet. Add a work or club calendar and Auto keeps its busy times free.</p> : null
      ) : (
        <ul className={styles.srows} aria-labelledby={`${pickerId}-head`} data-instant={instant ? "" : undefined}>
          {calendars.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              term={term}
              problem={host.problems[calendar.id]}
              onRemove={() => remove(calendar)}
              onCountAllDay={(on) =>
                onChange((p) => ({ ...p, calendars: p.calendars?.map((c) => (c.id === calendar.id ? { ...c, countAllDay: on } : c)) }))
              }
            />
          ))}
        </ul>
      )}
      {full && flow.step === "closed" ? <p className={styles.srowEmpty}>That&apos;s the most calendars you can add. Remove one to add another.</p> : null}

      {flow.step === "address" ? (
        <form id={pickerId} className={styles.picker} aria-label="Add a calendar" onSubmit={check} noValidate data-instant={instant ? "" : undefined}>
          <TextField
            ref={addressRef}
            size="sm"
            label="Calendar address"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://"
            value={flow.url}
            error={flow.error}
            help="In Google Calendar, open the calendar's settings and copy its secret address in iCal format."
            onChange={(e) => setFlow({ ...flow, url: e.target.value, error: null })}
          />
          <p className={styles.private}>
            <LockGlyph size={13} />
            <span>Kept private. UNTangle stores the address encrypted and keeps only the times you&apos;re busy. An event&apos;s name is kept only if you pick that event.</span>
          </p>
          <div className={styles.pickerActions}>
            <Button variant="ink" size="sm" type="button" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" type="submit" loading={flow.checking} loadingLabel="Checking">
              Check
            </Button>
          </div>
        </form>
      ) : flow.step === "checked" ? (
        <form id={pickerId} className={styles.picker} aria-label="Add a calendar" onSubmit={add} noValidate data-instant={instant ? "" : undefined}>
          <p className={styles.found} role="status">
            <Check size={15} />
            <span>{foundLine(flow.feed, flow.countAllDay, term.label)}</span>
          </p>
          {flow.feed.allDayEvents > 0 ? (
            <Switch
              className={styles.allDaySwitch}
              checked={flow.countAllDay}
              onChange={(on) => setFlow({ ...flow, countAllDay: on })}
              label="Count all-day events as busy"
              description="Auto then keeps each of those whole days free."
            />
          ) : null}
          <TextField
            ref={nameRef}
            size="sm"
            label="Name"
            placeholder="Work, Practice, Club"
            maxLength={40}
            value={flow.name}
            onChange={(e) => setFlow({ ...flow, name: e.target.value })}
          />
          {flow.error ? (
            <p className={styles.formError} role="alert">
              {flow.error}
            </p>
          ) : null}
          <div className={styles.pickerActions}>
            <Button variant="ink" size="sm" type="button" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" type="submit" loading={flow.adding} loadingLabel="Adding">
              Add calendar
            </Button>
          </div>
          <div className={styles.pickerAlt}>
            <button type="button" className={styles.add} aria-expanded={flow.picking} onClick={() => setFlow({ ...flow, picking: !flow.picking })}>
              Or pick one event from it
            </button>
          </div>
          {flow.picking ? (
            <EventList events={flow.feed.events} query={flow.query} onQuery={(query) => setFlow({ ...flow, query })} blocked={blocked} onPick={pickEvent} />
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
