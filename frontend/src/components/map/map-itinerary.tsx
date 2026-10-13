"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  formatClock,
  formatDistance,
  formatWalkMinutes,
  type Itinerary,
  type ItineraryLeg,
  type ItineraryStop,
} from "@/lib/map-itinerary";
import type { ClassDay } from "@/lib/types";
import { fromKeyboard, type MapSelection } from "@/components/map/selection";

const dayNames: Record<ClassDay, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/* ---------- day switcher ---------- */

export function DaySwitcher({
  days,
  activeDay,
  counts,
  onChange,
}: {
  /** Mon-Fri, plus a weekend day when the plan meets on it. */
  days: readonly ClassDay[];
  activeDay: ClassDay;
  counts: Record<ClassDay, number>;
  onChange: (day: ClassDay) => void;
}) {
  const refs = useRef<Partial<Record<ClassDay, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null);
  // The pill slides when a day is clicked and snaps for arrow keys and resizes.
  const [slide, setSlide] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const element = refs.current[activeDay];
      if (element) setPill({ x: element.offsetLeft, width: element.offsetWidth });
    };
    measure();
    const onResize = () => {
      setSlide(false);
      measure();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeDay, days]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = days[(days.indexOf(activeDay) + step + days.length) % days.length];
    setSlide(false);
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="mv-days" role="radiogroup" aria-label="Day" onKeyDown={onKeyDown}>
      {pill ? (
        <span
          className="mv-days__pill"
          aria-hidden="true"
          data-slide={slide ? "true" : "false"}
          style={{ width: pill.width, transform: `translateX(${pill.x}px)` }}
        />
      ) : null}
      {days.map((day) => {
        const active = day === activeDay;
        return (
          <button
            key={day}
            ref={(element) => {
              refs.current[day] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${dayNames[day]}, ${counts[day]} ${counts[day] === 1 ? "class" : "classes"}`}
            tabIndex={active ? 0 : -1}
            className="mv-days__day"
            data-active={active ? "true" : "false"}
            onClick={(event) => {
              setSlide(!fromKeyboard(event));
              onChange(day);
            }}
          >
            {day}
            <span className="mv-days__dot" data-has-classes={counts[day] > 0 ? "true" : "false"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/* ---------- summary ---------- */

function Tag({ children, title }: { children: string; title: string }) {
  return (
    <span className="mv-tag" title={title}>
      {children}
    </span>
  );
}

export function DaySummary({
  day,
  itinerary,
  source,
}: {
  day: ClassDay;
  itinerary: Itinerary;
  /** Where the day's sections come from ("Real, updated Oct 4", "Sample"); null before any loads. */
  source: { text: string; title: string } | null;
}) {
  const { summary } = itinerary;
  const parts: string[] = [];
  if (summary.classes === 0) {
    parts.push("No classes");
  } else {
    parts.push(`${summary.classes} ${summary.classes === 1 ? "class" : "classes"}`);
    if (summary.walkMinutes > 0) {
      parts.push(formatDistance(summary.walkMeters), `${formatWalkMinutes(summary.walkMinutes)} walking`);
    }
  }
  return (
    <div className="mv-summary">
      <h2 className="mv-summary__day">{dayNames[day]}</h2>
      <p className="mv-summary__line" aria-live="polite">
        <strong>{parts[0]}</strong>
        {parts.slice(1).map((part) => (
          <span key={part}>, {part}</span>
        ))}
        {summary.loading && summary.classes > 0 ? <span className="mv-summary__muted">, finding routes</span> : null}
        {summary.lateTransfers > 0 ? (
          <span className="mv-summary__warn">
            {" "}
            , {summary.lateTransfers} late {summary.lateTransfers === 1 ? "transfer" : "transfers"}
          </span>
        ) : null}
        {summary.tightTransfers > 0 ? (
          <span className="mv-summary__warn">
            {" "}
            , {summary.tightTransfers} tight {summary.tightTransfers === 1 ? "transfer" : "transfers"}
          </span>
        ) : null}
        {summary.unresolved > 0 ? <span className="mv-summary__muted">, {summary.unresolved} not on map</span> : null}
        {summary.shuttleLegs > 0 ? (
          <span className="mv-summary__muted">
            {" "}
            , {summary.shuttleLegs} shuttle {summary.shuttleLegs === 1 ? "ride" : "rides"}
          </span>
        ) : null}
      </p>
      <span className="mv-summary__tags">
        {summary.estimatedLegs > 0 ? (
          <Tag title="A dashed leg is a straight line between buildings. Its distance is approximate and it has no walking time.">
            Approx.
          </Tag>
        ) : null}
        {source ? <Tag title={source.title}>{source.text}</Tag> : null}
      </span>
    </div>
  );
}

/* ---------- timeline ---------- */

function timeRange(entry: ItineraryStop) {
  const start = formatClock(entry.stop.start);
  const end = formatClock(entry.stop.end);
  // "9:00–9:50 AM" when both share AM/PM, as the schedule writes it.
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
}

function StopCard({
  entry,
  selected,
  onSelect,
  cardRef,
}: {
  entry: ItineraryStop;
  selected: boolean;
  onSelect: (instant: boolean) => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}) {
  const { placement, stop } = entry;
  return (
    <button
      ref={cardRef}
      type="button"
      className="mv-stop"
      data-stop-key={entry.key}
      data-selected={selected ? "true" : "false"}
      data-placement={placement.kind}
      aria-pressed={selected}
      onClick={(event) => onSelect(fromKeyboard(event))}
    >
      <span className="mv-stop__badge" aria-hidden="true">
        {entry.number}
      </span>
      <span className="mv-stop__body">
        <span className="mv-stop__head">
          <span className="mv-stop__code">{stop.courseCode}</span>
          <span className="mv-stop__title">{stop.title}</span>
        </span>
        <span className="mv-stop__meta">
          {timeRange(entry)} in {stop.location}
          {entry.ownDates ? `, ${entry.ownDates}` : ""}
        </span>
        {placement.kind === "unresolved" ? (
          <span className="mv-stop__problem">
            <span className="mv-stop__flag">Not on map</span> {placement.message}
          </span>
        ) : null}
        {placement.kind === "resolving" ? <span className="mv-stop__problem">Looking up this building…</span> : null}
      </span>
      {placement.kind === "mapped" ? (
        <span className="mv-stop__building" aria-hidden="true">
          {placement.shortName}
        </span>
      ) : null}
    </button>
  );
}

const sourceLabel = { "campus-network": "campus walkways", ors: "OpenRouteService" } as const;

function WalkGlyph() {
  return (
    <svg className="mv-leg__glyph" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="9" cy="2.6" r="1.5" />
      <path d="M8.2 5.2 6.4 9l2.2 1.6.6 4M8.2 5.2l2.3 2.6 2 .6M6.4 9l-1 3.6M8.2 5.2 5.6 6.4 4.8 8.6" />
    </svg>
  );
}

type LegText = { main: string; source: string | null; detail: string | null };

function legText(leg: ItineraryLeg): LegText {
  const gap = `${leg.gapMinutes} min break`;
  switch (leg.route.kind) {
    case "loading":
      return { main: "Finding the walking route…", source: null, detail: null };
    case "same-building":
      return { main: `Same building, ${gap}`, source: null, detail: null };
    case "no-route":
      return { main: "No walking route", source: null, detail: "One end of this walk isn't on the map." };
    case "other-weeks":
      return { main: "No walk", source: null, detail: "These classes meet in different weeks of the term." };
    case "shuttle":
      return {
        main: `${Math.round(leg.route.seconds / 60)} min shuttle`,
        source: null,
        detail: `Discovery Park is a shuttle ride from main campus. ${Math.round(leg.route.seconds / 60)} minutes is an estimate. ${gap}.`,
      };
    case "straight-line":
      return {
        main: `~${formatDistance(leg.route.meters)}`,
        source: "straight line",
        detail: `Walking time unknown: no walkway route joins these buildings. ${gap}.`,
      };
    case "walk":
      return {
        main: `${formatWalkMinutes(leg.walkMinutes ?? 0)} walk, ${formatDistance(leg.route.meters)}`,
        source: sourceLabel[leg.route.source],
        detail: null,
      };
  }
}

function LegCard({
  leg,
  selected,
  onSelect,
  cardRef,
}: {
  leg: ItineraryLeg;
  selected: boolean;
  onSelect: (instant: boolean) => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}) {
  const { main, source, detail } = legText(leg);
  const drawable = leg.route.kind === "walk" || leg.route.kind === "straight-line";
  const flagged = leg.transfer === "tight" || leg.transfer === "late";
  const content = (
    <>
      <span className="mv-leg__row">
        <WalkGlyph />
        <span className="mv-leg__main">{main}</span>
        {source ? <span className="mv-leg__source">via {source}</span> : null}
        {leg.route.kind === "straight-line" ? <span className="mv-tag mv-tag--small">Approx.</span> : null}
      </span>
      {detail ? <span className="mv-leg__detail">{detail}</span> : null}
      {leg.leaveBy ? (
        <span className="mv-leg__detail">
          Leave by <strong>{formatClock(leg.leaveBy)}</strong> for a {leg.gapMinutes} min break
        </span>
      ) : null}
      {flagged ? (
        <span className="mv-leg__warn">
          {leg.transfer === "late"
            ? `The walk is ${(leg.walkMinutes ?? 0) - leg.gapMinutes} min longer than the break.`
            : `Tight transfer: ${leg.gapMinutes - (leg.walkMinutes ?? 0)} min to spare.`}
        </span>
      ) : null}
    </>
  );
  return (
    <div className="mv-leg" data-transfer={leg.transfer} data-route={leg.route.kind}>
      {drawable ? (
        <button
          ref={cardRef}
          type="button"
          className="mv-leg__card"
          data-leg-key={leg.key}
          data-selected={selected ? "true" : "false"}
          aria-pressed={selected}
          onClick={(event) => onSelect(fromKeyboard(event))}
        >
          {content}
        </button>
      ) : (
        <div className="mv-leg__card mv-leg__card--static" data-leg-key={leg.key}>
          {content}
        </div>
      )}
    </div>
  );
}

export function Timeline({
  itinerary,
  selection,
  onSelect,
  registerRow,
}: {
  itinerary: Itinerary;
  selection: MapSelection;
  onSelect: (selection: MapSelection) => void;
  registerRow: (key: string, element: HTMLElement | null) => void;
}) {
  return (
    <ol className="mv-timeline" aria-label="Classes and walks, in order">
      {itinerary.stops.map((entry, index) => {
        const leg = index > 0 ? itinerary.legs[index - 1] : null;
        return (
          <li key={entry.key} className="mv-timeline__item">
            {leg ? (
              <LegCard
                leg={leg}
                selected={selection?.kind === "leg" && selection.key === leg.key}
                onSelect={(instant) => onSelect({ kind: "leg", key: leg.key, instant })}
                cardRef={(element) => registerRow(leg.key, element)}
              />
            ) : null}
            <StopCard
              entry={entry}
              selected={selection?.kind === "stop" && selection.key === entry.key}
              onSelect={(instant) => onSelect({ kind: "stop", key: entry.key, instant })}
              cardRef={(element) => registerRow(entry.key, element)}
            />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A campus other than the planner's has no itinerary: the planner and its
 * sections are UNT's, so offering Schedule here would lead nowhere.
 */
export function OtherCampusEmpty({ campusName, homeName }: { campusName: string; homeName: string }) {
  return (
    <div className="mv-empty">
      <p>
        This {campusName} map shows buildings only. Your plan&rsquo;s classes are at {homeName}, so their walks are on the {homeName} map.
      </p>
      <Link className="mv-link" href="/map">
        Open the {homeName} map
      </Link>
    </div>
  );
}

export function EmptyDay({ day, firstDayWithClasses, onPickDay }: { day: ClassDay; firstDayWithClasses: ClassDay | undefined; onPickDay: (day: ClassDay) => void }) {
  return (
    <div className="mv-empty">
      {firstDayWithClasses ? (
        <>
          <p>No classes on {dayNames[day]}.</p>
          <button type="button" className="mv-link" onClick={() => onPickDay(firstDayWithClasses)}>
            Show {dayNames[firstDayWithClasses]}
          </button>
        </>
      ) : (
        <>
          <p>No classes in your plan yet.</p>
          <Link className="mv-link" href="/schedule">
            Pick sections in Schedule
          </Link>
        </>
      )}
    </div>
  );
}
