"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight, ExternalGlyph, Walk } from "@/components/ui/icons";
import { PathLine, PathStop, type PathLeg } from "@/components/ui/PathLine";
import { Plate } from "@/components/ui/Plate";
import { SearchPalette, type SearchSection } from "@/components/ui/SearchPalette";
import type { Hero } from "@/lib/leave-by";
import {
  clockParts,
  formatDistance,
  formatTime,
  formatWalkMinutes,
  START_KEY,
  toMinutes,
  type Itinerary,
  type ItineraryLeg,
  type ItineraryStop,
  type StartPlace,
} from "@/lib/map-itinerary";
import type { ClassDay, MapStop } from "@/lib/types";
import { dayNames } from "@/components/map/day-steps";
import { fromKeyboard, type MapSelection } from "@/components/map/selection";
import { searchStartPlaces, type StartPlaceOption } from "@/components/map/start-places";

/* ---------- stepper ---------- */

/**
 * Previous day, the day's name ("Today" for today), next day. The ends stop
 * rather than wrap. A press changes the day at once: the camera's fit is the
 * only motion (MOTION.md §6).
 */
export function DayStepper({
  days,
  day,
  today,
  onStep,
}: {
  days: readonly ClassDay[];
  day: ClassDay;
  today: ClassDay | null;
  onStep: (day: ClassDay, instant: boolean) => void;
}) {
  const index = days.indexOf(day);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = (direction: -1 | 1, instant: boolean) => {
    const target = days[index + direction];
    if (!target) return;
    onStep(target, instant);
    // Reaching an end disables the pressed button; keep focus in the stepper.
    const atEnd = !days[index + direction * 2];
    if (atEnd) (direction === 1 ? previous : next).current?.focus();
  };
  return (
    <div className="mv-stepper" role="group" aria-label="Day">
      <IconButton
        ref={previous}
        size="sm"
        label="Previous day"
        disabled={index <= 0}
        onClick={(event) => step(-1, fromKeyboard(event))}
      >
        <ChevronLeft />
      </IconButton>
      <h2 className="mv-stepper__day" aria-live="polite">
        {day === today ? "Today" : dayNames[day]}
      </h2>
      <IconButton
        ref={next}
        size="sm"
        label="Next day"
        disabled={index >= days.length - 1}
        onClick={(event) => step(1, fromKeyboard(event))}
      >
        <ChevronRight />
      </IconButton>
    </div>
  );
}

/* ---------- hero ---------- */

/** A time with its AM or PM, which CSS can set lighter than the digits. */
function Clock({ minutes }: { minutes: number }) {
  const { clock, half } = clockParts(minutes);
  return (
    <>
      {clock}
      <span className="mv-half"> {half}</span>
    </>
  );
}

type HeroCopy = {
  label: string;
  big: ReactNode;
  now?: boolean;
  chip?: { text: string; tight: boolean };
  sub: ReactNode;
  /** A day to jump to: on a free day, the next one with classes. */
  show?: ClassDay;
};

/** "GAB" for a placed building, the room text otherwise. */
function buildingOf(entry: ItineraryStop): string {
  return entry.placement.kind === "mapped" ? entry.placement.shortName : entry.stop.location;
}

function startsAt(stop: MapStop): string {
  return `${stop.courseCode} starts at ${formatTime(toMinutes(stop.start))} in ${stop.location}.`;
}

/** The next class after this day, for the hero on a free day or once the day is done. */
export type NextClass = { day: ClassDay; ahead: number; stop: MapStop } | null;

function nextClassLine(next: NextClass, isToday: boolean, prefix: "your-next" | "plain"): string | null {
  if (!next) return null;
  const when = isToday && next.ahead === 1 ? "tomorrow" : dayNames[next.day];
  const time = formatTime(toMinutes(next.stop.start));
  if (prefix === "your-next") return `Your next class is ${when} at ${time} in ${next.stop.location}.`;
  const lead = when === "tomorrow" ? "Tomorrow" : `On ${when}`;
  return `${lead}, ${next.stop.courseCode} starts at ${time} in ${next.stop.location}.`;
}

function heroCopy(
  hero: Hero,
  itinerary: Itinerary,
  { day, isToday, next, hasClasses }: { day: ClassDay; isToday: boolean; next: NextClass; hasClasses: boolean },
): HeroCopy {
  const on = isToday ? null : dayNames[day];
  const fromName = (index: number) =>
    index === 0 ? (itinerary.start?.place.name ?? "") : buildingOf(itinerary.stops[index - 1]);
  const walkOf = (index: number) => (index === 0 ? itinerary.start?.leg : itinerary.legs[index - 1]);
  switch (hero.kind) {
    case "no-classes":
      return {
        label: on ? `No classes on ${on}` : "No classes today",
        big: "Free",
        show: next && next.day !== day ? next.day : undefined,
        sub:
          nextClassLine(next, isToday, "your-next") ??
          (hasClasses ? (
            "No classes meet this week."
          ) : (
            <>
              No classes in this schedule yet. <Link href="/schedule">Pick sections in Week</Link>
            </>
          )),
      };
    case "leave": {
      const stop = itinerary.stops[hero.index].stop;
      const label = `Leave ${fromName(hero.index)} by`;
      return {
        label: on ? `On ${on}, ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label,
        big: <Clock minutes={hero.leave} />,
        chip:
          hero.minutesUntil === null
            ? undefined
            : hero.tight
              ? { text: "Right as class ends", tight: true }
              : { text: `in ${formatWalkMinutes(hero.minutesUntil)}`, tight: false },
        sub: startsAt(stop),
      };
    }
    case "leave-now": {
      const entry = itinerary.stops[hero.index];
      const walk = walkOf(hero.index)?.walkMinutes;
      return {
        label: `Head to ${buildingOf(entry)} now`,
        big: "Leave now",
        now: true,
        chip: walk ? { text: `${walk} min walk`, tight: hero.tight } : undefined,
        sub: startsAt(entry.stop),
      };
    }
    case "next-class": {
      const { stop } = itinerary.stops[hero.index];
      return {
        label: on ? `On ${on}, the first class is at` : "Next class at",
        big: <Clock minutes={toMinutes(stop.start)} />,
        chip: hero.minutesUntil === null ? undefined : { text: `in ${formatWalkMinutes(hero.minutesUntil)}`, tight: false },
        sub: `${stop.courseCode} in ${stop.location}.`,
      };
    }
    case "overlap": {
      const { stop } = itinerary.stops[hero.index];
      const previous = itinerary.stops[hero.index - 1].stop;
      return {
        label: `${stop.courseCode} overlaps ${previous.courseCode}`,
        big: <Clock minutes={toMinutes(stop.start)} />,
        sub: (
          <>
            It starts before {previous.courseCode} ends at {formatTime(toMinutes(previous.end))}.{" "}
            <Link href="/schedule">Change one in Week</Link>
          </>
        ),
      };
    }
    case "last-class": {
      const { stop } = itinerary.stops[hero.index];
      return { label: `In ${stop.courseCode} until ${formatTime(toMinutes(stop.end))}`, big: "Last one", sub: "Nothing after this today." };
    }
    case "done":
      return { label: "Done for today", big: "That's it", sub: nextClassLine(next, true, "plain") ?? "No more classes this week." };
  }
}

export function DayHero({
  hero,
  itinerary,
  day,
  isToday,
  next,
  hasClasses,
  onShowDay,
}: {
  hero: Hero;
  itinerary: Itinerary;
  day: ClassDay;
  isToday: boolean;
  next: NextClass;
  /** Whether the schedule has any timed class at all. */
  hasClasses: boolean;
  onShowDay: (day: ClassDay, instant: boolean) => void;
}) {
  const copy = heroCopy(hero, itinerary, { day, isToday, next, hasClasses });
  return (
    <div className="mv-hero">
      <p className="mv-hero__label">{copy.label}</p>
      <p className="mv-hero__big" data-now={copy.now ? "true" : undefined}>
        {copy.big}
      </p>
      {copy.chip ? (
        <span className="mv-hero__chip" data-tight={copy.chip.tight ? "true" : undefined}>
          {copy.chip.text}
        </span>
      ) : null}
      <p className="mv-hero__sub">{copy.sub}</p>
      {copy.show ? (
        <button type="button" className="mv-link mv-hero__show" onClick={(event) => onShowDay(copy.show!, fromKeyboard(event))}>
          Show {dayNames[copy.show]}
        </button>
      ) : null}
    </div>
  );
}

/* ---------- itinerary ---------- */

function legTone(leg: ItineraryLeg, past: boolean): PathLeg {
  if (past) return "past";
  if (leg.transfer === "late" || leg.transfer === "tight") return leg.transfer;
  const { kind } = leg.route;
  return kind === "walk" || kind === "same-building" || kind === "shuttle" ? "walk" : "todo";
}

/** The one fact a leg row carries: its minutes, or why it has none. */
function legMain(leg: ItineraryLeg): string {
  switch (leg.route.kind) {
    case "walk":
      return formatWalkMinutes(leg.walkMinutes ?? 0);
    case "shuttle":
      return `${leg.walkMinutes} min shuttle`;
    case "straight-line":
      return "Walk time unknown";
    case "same-building":
      return "Same building";
    case "loading":
      return "Finding the route";
    case "no-route":
      return "No walking route";
    case "other-weeks":
      return "Different weeks";
  }
}

/** Only a tight or late walk adds a line (rule 7). */
function legNote(leg: ItineraryLeg): string | null {
  if (leg.transfer === "late" && leg.walkMinutes !== null && leg.gapMinutes !== null) {
    return `${leg.walkMinutes - leg.gapMinutes} min late`;
  }
  if (leg.transfer === "tight" && leg.leaveAt !== null) return `Leave right at ${formatTime(leg.leaveAt)}`;
  return null;
}

/** Every walk opens to say more, except one still being routed. */
const expandable = (leg: ItineraryLeg) => leg.fromKey === START_KEY || leg.route.kind !== "loading";

const sourceLabel = { "campus-network": "campus walkways", ors: "OpenRouteService" } as const;

/** What a selected walk adds to its minutes: how far and by which route, or why it has no time. */
function legFacts(leg: ItineraryLeg): string | null {
  switch (leg.route.kind) {
    case "walk":
      return `${formatDistance(leg.route.meters)} via ${sourceLabel[leg.route.source]}`;
    case "straight-line":
      return `About ${formatDistance(leg.route.meters)} in a straight line. No walkway joins these buildings, so the walk time is unknown.`;
    case "shuttle":
      return `Discovery Park is a shuttle ride from main campus. ${leg.walkMinutes} minutes is an estimate.`;
    case "no-route":
      return "One end of this walk isn't on the map, so there's no route.";
    case "other-weeks":
      return "These classes meet in different weeks of the term, so there's no walk between them.";
    case "same-building":
    case "loading":
      return null;
  }
}

function LegDetail({ leg, start, onChangeStart }: { leg: ItineraryLeg; start: StartPlace | null; onChangeStart: () => void }) {
  const leave = leg.leaveAt === null ? null : formatTime(leg.leaveAt);
  const facts = legFacts(leg);
  const timing = start
    ? leave && `Leave by ${leave} from ${start.name}`
    : leg.gapMinutes === null || leg.route.kind === "other-weeks"
      ? null
      : leave
        ? `Leave by ${leave}, ${leg.gapMinutes} min break`
        : `${leg.gapMinutes} min break`;
  return (
    <div className="mv-more mv-more--leg">
      {timing ? <span>{timing}</span> : null}
      {facts ? <span>{facts}</span> : null}
      {start ? (
        <button type="button" className="mv-link" onClick={onChangeStart}>
          Change starting point
        </button>
      ) : null}
    </div>
  );
}

function LegRow({
  leg,
  start,
  past,
  selected,
  onSelect,
  onChangeStart,
  rowRef,
}: {
  leg: ItineraryLeg;
  /** Set on the walk from the starting point. */
  start: StartPlace | null;
  past: boolean;
  selected: boolean;
  onSelect: (instant: boolean) => void;
  onChangeStart: () => void;
  rowRef: (element: HTMLElement | null) => void;
}) {
  const note = legNote(leg);
  const content = (
    <>
      <Walk className="mv-leg__glyph" />
      <span className="mv-leg__main">{legMain(leg)}</span>
      {leg.route.kind === "walk" ? <span className="sr-only-v2"> walk{start ? ` from ${start.name}` : ""}</span> : null}
      {note ? <span className="mv-leg__note">{note}</span> : null}
    </>
  );
  return (
    <div className="mv-leg" data-route={leg.route.kind} data-transfer={leg.transfer} data-past={past ? "true" : undefined}>
      {expandable(leg) ? (
        <button
          ref={rowRef}
          type="button"
          className="mv-leg__row"
          data-leg-key={leg.key}
          aria-expanded={selected}
          onClick={(event) => onSelect(fromKeyboard(event))}
        >
          {content}
        </button>
      ) : (
        <div ref={rowRef} className="mv-leg__row mv-leg__row--static" data-leg-key={leg.key}>
          {content}
        </div>
      )}
      {selected ? <LegDetail leg={leg} start={start} onChangeStart={onChangeStart} /> : null}
    </div>
  );
}

function directionsHref(entry: ItineraryStop): string | null {
  if (entry.placement.kind !== "mapped") return null;
  const { lat, lng } = entry.placement.point;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

function StopRow({
  entry,
  past,
  selected,
  onSelect,
  rowRef,
}: {
  entry: ItineraryStop;
  past: boolean;
  selected: boolean;
  onSelect: (instant: boolean) => void;
  rowRef: (element: HTMLElement | null) => void;
}) {
  const { placement, stop } = entry;
  const directions = directionsHref(entry);
  return (
    <>
      <button
        ref={rowRef}
        type="button"
        className="mv-stop"
        data-stop-key={entry.key}
        data-placement={placement.kind}
        data-past={past ? "true" : undefined}
        aria-expanded={selected}
        onClick={(event) => onSelect(fromKeyboard(event))}
      >
        <span className="mv-stop__code">{stop.courseCode}</span>
        {placement.kind === "mapped" ? (
          <Plate building={placement.shortName} name={placement.buildingName} className="mv-stop__plate" />
        ) : placement.kind === "unresolved" ? (
          <span className="mv-stop__off">Not on map</span>
        ) : null}
        <span className="mv-stop__time">
          <Clock minutes={toMinutes(stop.start)} />
        </span>
      </button>
      {/* Printed for every class; on screen only when selected. */}
      <div className={selected ? "mv-more" : "mv-more mv-more--print"}>
        <span>{stop.title}</span>
        <span>
          In {stop.location} until {formatTime(toMinutes(stop.end))}
        </span>
        {entry.ownDates ? <span>Meets {entry.ownDates}</span> : null}
        {placement.kind === "unresolved" ? <span>{placement.message}</span> : null}
        {placement.kind === "resolving" ? <span>Looking up this building…</span> : null}
        {directions && selected ? (
          <a className="mv-link" href={directions} target="_blank" rel="noreferrer">
            Directions in Google Maps
            <ExternalGlyph size={12} />
            <span className="sr-only-v2"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </>
  );
}

/**
 * The day on the shared path line: a ring for the starting point, then each
 * class with the walk after it. A stop row carries the time and the
 * building; a walk carries its minutes, plus one line when it's tight or
 * late. Choosing a row expands it in place, with no animation.
 */
export function DayItinerary({
  itinerary,
  selection,
  onSelect,
  now,
  onChangeStart,
  registerRow,
}: {
  itinerary: Itinerary;
  selection: MapSelection;
  onSelect: (selection: MapSelection) => void;
  /** The minute of today when the day shown is today; earlier rows dim. */
  now: number | null;
  onChangeStart: () => void;
  registerRow: (key: string, element: HTMLElement | null) => void;
}) {
  const { start, stops, legs } = itinerary;
  const isSelected = (kind: "stop" | "leg", key: string) => selection?.kind === kind && selection.key === key;
  const toggle = (kind: "stop" | "leg", key: string) => (instant: boolean) =>
    onSelect(isSelected(kind, key) ? null : { kind, key, instant });
  const stopPast = (entry: ItineraryStop) => now !== null && now >= toMinutes(entry.stop.end);
  // A walk is behind you once the class it leads to has started.
  const legPast = (leg: ItineraryLeg) => {
    const to = stops.find((entry) => entry.key === leg.toKey);
    return now !== null && to !== undefined && now >= toMinutes(to.stop.start);
  };

  return (
    <PathLine label="Classes and walks, in order" className="mv-itin">
      <PathStop tone="ring" leg={start ? legTone(start.leg, legPast(start.leg)) : "todo"} className="mv-itin__start">
        {start ? (
          <LegRow
            leg={start.leg}
            start={start.place}
            past={legPast(start.leg)}
            selected={isSelected("leg", start.leg.key)}
            onSelect={toggle("leg", start.leg.key)}
            onChangeStart={onChangeStart}
            rowRef={(element) => registerRow(start.leg.key, element)}
          />
        ) : (
          <button type="button" className="mv-link mv-itin__set-start" onClick={onChangeStart}>
            Set where you start
          </button>
        )}
      </PathStop>
      {stops.map((entry, index) => {
        const leg = legs[index];
        const past = stopPast(entry);
        return (
          <PathStop
            key={entry.key}
            marker={entry.number}
            tone={past ? "past" : "default"}
            leg={leg ? legTone(leg, legPast(leg)) : undefined}
          >
            <StopRow
              entry={entry}
              past={past}
              selected={isSelected("stop", entry.key)}
              onSelect={toggle("stop", entry.key)}
              rowRef={(element) => registerRow(entry.key, element)}
            />
            {leg ? (
              <LegRow
                leg={leg}
                start={null}
                past={legPast(leg)}
                selected={isSelected("leg", leg.key)}
                onSelect={toggle("leg", leg.key)}
                onChangeStart={onChangeStart}
                rowRef={(element) => registerRow(leg.key, element)}
              />
            ) : null}
          </PathStop>
        );
      })}
    </PathLine>
  );
}

/* ---------- starting point ---------- */

/**
 * Search for where the day starts: a residence hall, a garage, any named
 * building. A list this long opens a search, never a dropdown.
 */
export function StartPicker({
  open,
  onOpenChange,
  places,
  current,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: readonly StartPlaceOption[];
  current: StartPlace | null;
  onPick: (place: StartPlace | null) => void;
}) {
  const [query, setQuery] = useState("");
  const found = useMemo(() => searchStartPlaces(places, query), [places, query]);
  const sections: SearchSection[] = [
    { id: "places", label: "Buildings", items: found.map((place) => ({ id: place.id, code: place.code ?? undefined, title: place.name })) },
    ...(current && !query.trim() ? [{ id: "clear", label: `Starting at ${current.name}`, items: [{ id: "none", title: "Don't use a starting point" }] }] : []),
  ];
  const close = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  return (
    <SearchPalette
      open={open}
      onOpenChange={close}
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      placeholder="Where you start the day"
      emptyQueryHint="Type a residence hall, garage or building."
      noMatchText={(q) => `No building matches “${q}”.`}
      onSelect={(item) => {
        const place = places.find((candidate) => candidate.id === item.id);
        onPick(place ? { name: place.name, point: place.point } : null);
        close(false);
      }}
    />
  );
}
