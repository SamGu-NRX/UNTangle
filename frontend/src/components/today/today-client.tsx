"use client";

/**
 * /today client — one glance: where am I supposed to be, when does it end,
 * and how do I get to the next thing. Phases come from the pure engine;
 * this component owns rendering, the minute tick, the walk fetch, and the
 * offline snapshot. State updates are wrapped in startTransition so the
 * tick never blocks input, and the walk-pair ref is updated inside the
 * effect (never during render).
 */
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import {
  computeTodayState,
  decideWalk,
  findNextSchoolDay,
  formatCountdown,
  formatDistance,
  toTodayStops,
  weekdayOf,
  type BuildResolver,
  type NextSchoolDay,
  type TodayStop,
  type WalkDecision,
  type WalkState,
} from "@/components/today/today-engine";
import { fetchWalk, walkSummary } from "@/components/today/route-client";
import {
  formatSnapshotTime,
  loadScheduleSnapshot,
  saveScheduleSnapshot,
} from "@/components/today/offline-snapshot";
import { weekDays, type ScheduleEvent, type WeekDay } from "@/lib/types";
import styles from "./today.module.css";

export type TodayClientProps = {
  events: ScheduleEvent[];
  resolve: BuildResolver;
  now?: Date;
};

/** Building short name from a resolved place; "?" keeps honest when unresolved. */
function shortNameOf(stop: TodayStop | null): string {
  return stop?.place?.shortName ?? "?";
}

function placeLabel(stop: TodayStop | null): string {
  if (!stop) {
    return "";
  }
  return stop.place ? stop.place.buildingName : `${stop.location} (building not in directory)`;
}

const PHASE_COPY: Record<string, string> = {
  "before-first": "Before your first class",
  current: "In class now",
  between: "Between classes",
  "after-last": "Classes are done for today",
  "no-classes": "No classes today",
};

const DAYS_AHEAD_COPY = ["", "tomorrow", "in 2 days", "in 3 days", "in 4 days"];

export function TodayClient({ events, resolve, now }: TodayClientProps) {
  const [clock, setClock] = useState<Date>(() => now ?? new Date());
  const [walk, setWalk] = useState<WalkState>({ kind: "loading" });
  const [routeError, setRouteError] = useState<string | null>(null);
  const [snapshotTime, setSnapshotTime] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const walkPairRef = useRef<string | null>(null);

  const effectiveEvents = useMemo(
    () => (showAll ? events : events.filter((event) => event.day === weekdayOf(clock))),
    [events, showAll, clock],
  );

  // Minute tick — keep the countdown honest without hammering the engine.
  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => {
        setClock(new Date());
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Persist the schedule the first time it loads, remember when it was saved.
  useEffect(() => {
    if (events.length > 0 && saveScheduleSnapshot(events)) {
      const snap = loadScheduleSnapshot();
      setSnapshotTime(snap?.savedAt ?? null);
    }
  }, [events]);

  const state = useMemo(
    () => computeTodayState({ now: clock, eventsForToday: effectiveEvents, resolve }),
    [clock, effectiveEvents, resolve],
  );

  const walkPair = useMemo(() => {
    const from = state.phase === "between" ? state.previousStop : state.phase === "current" ? state.currentStop : null;
    return decideWalk(from, state.nextStop);
  }, [state]);

  // Fetch the walk route when the pair changes; guard with a ref so a fast
  // re-render cannot double-fire, and surface failures as an honest notice.
  useEffect(() => {
    if (walkPair.kind !== "needs-route") {
      walkPairRef.current = null;
      return;
    }
    const { from, to } = walkPair;
    const pairKey = `${from.sectionId}->${to.sectionId}`;
    if (walkPairRef.current === pairKey) {
      return;
    }
    walkPairRef.current = pairKey;
    let cancelled = false;
    setWalk({ kind: "loading" });
    setRouteError(null);
    startTransition(() => {
      fetchWalk(from, to)
        .then((result) => {
          if (cancelled) {
            return;
          }
          startTransition(() => {
            if (result.kind === "unavailable") {
              setWalk({ kind: "unavailable" });
              setRouteError("No walking route available right now — check the campus map.");
            } else {
              setWalk(result);
            }
          });
        })
        .catch(() => {
          if (!cancelled) {
            startTransition(() => {
              setWalk({ kind: "unavailable" });
              setRouteError("No walking route available right now — check the campus map.");
            });
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [walkPair]);

  const weekAhead = useMemo(() => {
    const stopsByWeekDay: Partial<Record<WeekDay, TodayStop[]>> = {};
    for (const day of weekDays) {
      stopsByWeekDay[day] = toTodayStops(
        events.filter((event) => event.day === day),
        resolve,
      );
    }
    return findNextSchoolDay({ now: clock, stopsByDay: stopsByWeekDay });
  }, [clock, events, resolve]);

  const next: NextSchoolDay | null =
    state.phase === "after-last" || state.phase === "no-classes" ? weekAhead : null;

  return (
    <section className={styles.wrap} aria-label="Today schedule">
      {snapshotTime !== null ? (
        <p className={styles.snapshotNote}>{formatSnapshotTime(snapshotTime)} — available offline</p>
      ) : null}

      <header className={styles.header}>
        <p className={styles.phaseLabel}>{PHASE_COPY[state.phase] ?? state.phase}</p>
        {state.isWeekend ? <p className={styles.weekendNote}>It’s the weekend — no classes today.</p> : null}
      </header>

      {state.currentStop ? (
        <article className={styles.card} aria-label="Current class">
          <p className={styles.cardMeta}>{state.currentStop.courseCode}</p>
          <h2 className={styles.cardTitle}>{state.currentStop.title}</h2>
          <p className={styles.cardMeta}>{placeLabel(state.currentStop)}</p>
          <p className={styles.countdown}>
            {state.countdownKind === "until-end" && state.countdownSeconds !== null
              ? `${formatCountdown(state.countdownSeconds)} left`
              : "Ending soon"}
          </p>
        </article>
      ) : null}

      {state.phase === "between" && state.nextStop ? (
        <article className={styles.card} aria-label="Next class">
          <p className={styles.cardMeta}>
            {state.previousStop ? `After ${state.previousStop.courseCode}` : "Up next"}
          </p>
          <h2 className={styles.cardTitle}>{state.nextStop.title}</h2>
          <p className={styles.cardMeta}>{placeLabel(state.nextStop)}</p>
          <p className={styles.countdown}>
            starts in {state.countdownSeconds !== null ? formatCountdown(state.countdownSeconds) : "—"}
          </p>
        </article>
      ) : null}

      {state.phase === "before-first" && state.nextStop ? (
        <article className={styles.card} aria-label="First class">
          <p className={styles.cardMeta}>First class</p>
          <h2 className={styles.cardTitle}>{state.nextStop.title}</h2>
          <p className={styles.cardMeta}>{placeLabel(state.nextStop)}</p>
          <p className={styles.countdown}>
            starts in {state.countdownSeconds !== null ? formatCountdown(state.countdownSeconds) : "—"}
          </p>
        </article>
      ) : null}

      {walkPair.kind === "same-building" ? (
        <p className={styles.walkNote}>Stay put — next class is in {walkPair.buildingName}.</p>
      ) : null}

      {walkPair.kind === "unresolvable" ? (
        <p className={styles.walkNote}>
          One of the buildings isn’t in the campus directory yet, so walk routing is unavailable for this class
          change.
        </p>
      ) : null}

      {walkPair.kind === "needs-route" ? (
        <div className={styles.walkCard} aria-label="Walk guidance">
          {walk.kind === "loaded" ? (
            <>
              <p className={styles.walkTitle}>Walk to {shortNameOf(state.nextStop)}</p>
              <p className={styles.walkDetail}>{walkSummary(walk.route)}</p>
              {walk.route.source === "fallback" ? (
                <p className={styles.walkFallbackNote}>Straight-line estimate — not a routed path.</p>
              ) : null}
              <p className={styles.walkDetail}>{formatDistance(walk.route.distanceMeters)}</p>
            </>
          ) : walk.kind === "loading" ? (
            <p className={styles.walkDetail}>Finding the route…</p>
          ) : (
            <p className={styles.walkDetail}>Route unavailable.</p>
          )}
          {routeError ? (
            <p role="status" className={styles.walkError}>
              {routeError}
            </p>
          ) : null}
        </div>
      ) : null}

      {next ? (
        <article className={styles.card} aria-label="Next school day">
          <p className={styles.cardMeta}>
            Next class {DAYS_AHEAD_COPY[next.daysAhead] ?? `in ${next.daysAhead} days`} ({next.day})
          </p>
          <h2 className={styles.cardTitle}>{next.stop.title}</h2>
          <p className={styles.cardMeta}>
            {placeLabel(next.stop)} — {next.stop.start}
          </p>
        </article>
      ) : null}

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShowAll((value) => !value)}
          aria-pressed={showAll}
        >
          {showAll ? "Showing the whole week" : "Showing today only"}
        </button>
      </div>

      {showAll ? (
        <ul className={styles.weekList}>
          {weekDays.map((day) => {
            const stops = toTodayStops(
              events.filter((event) => event.day === day),
              resolve,
            );
            return (
              <li key={day} className={styles.weekDay}>
                <p className={styles.weekDayLabel}>{day}</p>
                {stops.length === 0 ? (
                  <p className={styles.weekDayEmpty}>Nothing scheduled</p>
                ) : (
                  stops.map((stop) => (
                    <p key={stop.sectionId} className={styles.weekDayItem}>
                      {stop.start} {stop.courseCode} — {shortNameOf(stop)}
                    </p>
                  ))
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
