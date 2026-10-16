"use client";

import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CalendarGlyph, LockGlyph, Walk } from "@/components/ui/icons";
import type { Day } from "@/lib/sections";
import { EXIT_MOVE_MS, flip, measure, MOVE_MS, settleBack, visualOf } from "./motion";
import styles from "./builder.module.css";
import { DAY_NAME, daysShown, hourRange, timeRange, type GridEvent, type Placement, type WalkLeg } from "./week";

/** A dotted outline for another section of the selected course (DESIGN.md §4.3). */
export type Outline = {
  courseCode: string;
  sectionId: string;
  label: string;
  day: Day;
  start: number;
  end: number;
  clash: boolean;
  days: string;
  /** The event key this meeting takes when its section is chosen (course plus occurrence). */
  targetKey: string;
};
/** One meeting of the section being pointed at in search. */
export type Ghost = { courseCode: string; day: Day; start: number; end: number; clash: boolean };
/**
 * Busy time the grid hatches. Without a kind, the student's own weekly busy
 * time; `dated`, one they made from a calendar event, on its date only;
 * `calendar`, a connected calendar's. `note` says which weeks it holds.
 */
export type Busy = {
  id: string;
  label: string;
  day: Day;
  start: number;
  end: number;
  kind?: "dated" | "calendar";
  note?: string;
  /** A class meets during this busy time: the class takes the band's left part, so the band's words show beside it. */
  beside?: boolean;
};

/**
 * How much of its lane a class keeps when it meets during dated busy time,
 * leaving the rest for the busy band's words. Phone columns are too narrow to
 * share, so there the class keeps its lane and carries the busy time's name
 * and date itself.
 */
const BESIDE_SHARE = 0.6;

/** Calendar busy time can run all day; the grid stretches for it only within these hours. */
const CALENDAR_REACH = { start: 8 * 60, end: 21 * 60 };
const reach = (block: Busy) =>
  block.kind === "calendar" ? { start: Math.max(block.start, CALENDAR_REACH.start), end: Math.min(block.end, CALENDAR_REACH.end) } : block;

type Props = {
  label: string;
  events: readonly GridEvent[];
  placements: Map<string, Placement>;
  walks: readonly WalkLeg[];
  hueOf: (courseCode: string) => number;
  kept: ReadonlySet<string>;
  selectedCourse: string | null;
  outlines: readonly Outline[];
  ghost: readonly Ghost[];
  busy: readonly Busy[];
  /**
   * Classes that meet during dated busy time (a calendar's, or one event's),
   * by event key: what to say on the class, such as "Work, Feb 16". Marked
   * the way a clash between classes is.
   */
  busyClash?: ReadonlyMap<string, string>;
  /** Class hours and days off from Preferences, hatched so the week shows what Auto avoids. */
  limits?: { earliestStart: number | null; latestEnd: number | null; daysOff: readonly Day[] };
  /**
   * Names the sections on the grid; a new key FLIPs them, unless `instant`
   * (keyboard changes never animate). `exit` (Undo, leaving a preview) moves
   * a little faster.
   */
  motion: { key: string; instant: boolean; exit?: boolean };
  /** False while an alternative is previewed, and on paper. */
  interactive: boolean;
  phone: boolean;
  onSelect: (event: GridEvent, fromKeyboard: boolean) => void;
  /** Returns false when the pick didn't apply, so a dropped event springs back. */
  onPick: (courseCode: string, sectionId: string, fromKeyboard: boolean) => boolean;
  /** The course being dragged, so its other sections show; null when the drag ends. */
  onDrag: (courseCode: string | null) => void;
  /** Fine pointers drag across empty time to add a busy time. */
  onBusy?: (block: { day: Day; start: number; end: number }) => void;
  footer: ReactNode;
  empty?: ReactNode;
};

/** Inline styles that also set custom properties, which CSSProperties doesn't list. */
type CSSVars = CSSProperties & { [property: `--${string}`]: string | number };

const SNAP = 15;
/** A drag this close to a section outline's center drops onto it. */
const SNAP_RADIUS = 90;

/** Down from the top of a column: the inset above the first hour (builder.module.css), then the hours. */
const at = (minutes: number, first: number): string => `calc(var(--grid-top) + ${(minutes - first * 60) / 60} * var(--hh))`;
const span = (start: number, end: number): string => `calc(${(end - start) / 60} * var(--hh))`;

function lane(placement: Placement | undefined, share = 1): CSSProperties {
  const { lane: index = 0, lanes = 1 } = placement ?? {};
  return {
    left: `calc(${index} * (100% - 8px) / ${lanes} + 4px)`,
    width: share === 1 ? `calc((100% - 8px) / ${lanes} - ${lanes > 1 ? 2 : 0}px)` : `calc(((100% - 8px) / ${lanes} - ${lanes > 1 ? 2 : 0}px) * ${share})`,
  };
}

export function WeekGrid(props: Props) {
  const { events, placements, walks, outlines, ghost, busy, phone, interactive } = props;
  const days = daysShown([...events, ...busy, ...ghost, ...outlines]);
  const { first, last } = hourRange([...events, ...busy.map(reach).filter((span) => span.end > span.start), ...ghost, ...outlines]);
  const body = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, { x: number; y: number }> | null>(null);
  const lastMotion = useRef(props.motion.key);
  const drag = useRef<{
    id: number;
    key: string;
    code: string;
    x: number;
    y: number;
    moved: boolean;
    near: HTMLElement | null;
    /** Measured once when the drag starts: the box's center and each outline's (MOTION.md §11). */
    center: { x: number; y: number } | null;
    targets: Array<{ element: HTMLElement; x: number; y: number }> | null;
    frame: number;
  } | null>(null);
  const swallowClick = useRef(false);
  const [draft, setDraft] = useState<{ day: Day; from: number; to: number } | null>(null);

  // Section changes FLIP from where events were (pointer only); any other render just re-measures.
  useLayoutEffect(() => {
    const root = body.current;
    if (!root) return;
    const elements = [...root.querySelectorAll<HTMLElement>("[data-event]")];
    if (props.motion.key !== lastMotion.current) {
      lastMotion.current = props.motion.key;
      if (!props.motion.instant && positions.current) flip(root, elements, positions.current, props.motion.exit ? EXIT_MOVE_MS : MOVE_MS());
    }
    positions.current = measure(elements);
  });

  const minuteAt = (column: HTMLElement, clientY: number) => {
    const rect = column.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(column).getPropertyValue("--grid-top")) || 0;
    const raw = first * 60 + ((clientY - rect.top - inset) / (rect.height - inset)) * (last - first) * 60;
    return Math.max(first * 60, Math.min(last * 60, Math.round(raw / SNAP) * SNAP));
  };

  const onColumnDown = (event: ReactPointerEvent<HTMLDivElement>, day: Day) => {
    if (!props.onBusy || !interactive || event.pointerType !== "mouse" || event.button !== 0 || event.target !== event.currentTarget) return;
    const minute = minuteAt(event.currentTarget, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ day, from: minute, to: minute });
  };
  const onColumnMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const minute = minuteAt(event.currentTarget, event.clientY);
    if (minute !== draft.to) setDraft({ ...draft, to: minute });
  };
  const onColumnUp = () => {
    if (!draft) return;
    const start = Math.min(draft.from, draft.to);
    const end = Math.max(draft.from, draft.to);
    setDraft(null);
    if (end - start >= SNAP) props.onBusy?.({ day: draft.day, start, end });
  };

  const onEventDown = (event: ReactPointerEvent<HTMLButtonElement>, gridEvent: GridEvent) => {
    if (!interactive || event.pointerType !== "mouse" || event.button !== 0) return;
    drag.current = { id: event.pointerId, key: gridEvent.key, code: gridEvent.courseCode, x: event.clientX, y: event.clientY, moved: false, near: null, center: null, targets: null, frame: 0 };
  };
  const onEventMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    const element = event.currentTarget;
    if (!state.moved) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6) return;
      state.moved = true;
      // Grabbed mid-flight (a swap or a spring back): take over from where it is drawn.
      const live = new DOMMatrixReadOnly(getComputedStyle(element).transform === "none" ? undefined : getComputedStyle(element).transform);
      element.getAnimations().forEach((animation) => animation.cancel());
      state.x -= live.m41;
      state.y -= live.m42;
      const rect = element.getBoundingClientRect();
      state.center = { x: rect.left + rect.width / 2 - live.m41, y: rect.top + rect.height / 2 - live.m42 };
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "";
      props.onDrag(state.code);
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      // The outlines render after the drag starts; measure them once, on the first frame they exist.
      state.targets ??= [...(body.current?.querySelectorAll<HTMLElement>("[data-outline]") ?? [])].map((outline) => {
        const box = outline.getBoundingClientRect();
        return { element: outline, x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      if (state.targets.length === 0) state.targets = null;
      const cx = state.center!.x + dx;
      const cy = state.center!.y + dy;
      let best: HTMLElement | null = null;
      let distance = SNAP_RADIUS;
      for (const target of state.targets ?? []) {
        const d = Math.hypot(target.x - cx, target.y - cy);
        if (d < distance) {
          distance = d;
          best = target.element;
        }
      }
      if (best !== state.near) {
        state.near?.removeAttribute("data-near");
        best?.setAttribute("data-near", "");
        state.near = best;
      }
    });
  };
  const endDrag = (element: HTMLButtonElement, drop: boolean) => {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;
    cancelAnimationFrame(state.frame);
    swallowClick.current = true;
    delete element.dataset.dragging;
    state.near?.removeAttribute("data-near");
    const target = drop ? state.near : null;
    const from = element.style.transform;
    if (target?.dataset.section && target.dataset.targetKey && body.current && positions.current) {
      // The box lands where it was dropped: the occurrence the outline stands for starts there,
      // and the dragged occurrence, if it still exists, starts where that one was.
      const dropped = visualOf(body.current, element);
      const previous = positions.current.get(target.dataset.targetKey);
      positions.current.set(target.dataset.targetKey, dropped);
      if (target.dataset.targetKey !== state.key) {
        if (previous) positions.current.set(state.key, previous);
        else positions.current.delete(state.key);
      }
      element.style.transform = "";
      if (props.onPick(state.code, target.dataset.section, false)) {
        props.onDrag(null);
        return;
      }
    }
    settleBack(element, from);
    props.onDrag(null);
  };
  const onEventUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current && event.pointerId === drag.current.id) endDrag(event.currentTarget, true);
  };
  const onEventCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current && event.pointerId === drag.current.id) endDrag(event.currentTarget, false);
  };

  const headStyle: CSSVars = { "--cols": days.length };
  const bodyStyle: CSSVars = { "--cols": days.length, height: `calc(${last - first} * var(--hh) + var(--grid-top))` };

  return (
    <section className={styles.grid} aria-label={props.label} data-phone={phone ? "" : undefined}>
      <div className={styles.gridHead} style={headStyle} aria-hidden="true">
        <span />
        {days.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div
        ref={body}
        className={styles.gridBody}
        style={bodyStyle}
      >
        <div className={styles.gutter} aria-hidden="true">
          {Array.from({ length: last - first }, (_, i) => first + i).map((hour) => (
            <span key={hour} style={{ top: at(hour * 60, first) }}>
              {hour % 12 === 0 ? 12 : hour % 12}
              {phone ? "" : hour < 12 ? " AM" : " PM"}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className={styles.day}
            role="group"
            aria-label={DAY_NAME[day]}
            data-day={day}
            data-drawing={draft?.day === day ? "" : undefined}
            onPointerDown={(event) => onColumnDown(event, day)}
            onPointerMove={onColumnMove}
            onPointerUp={onColumnUp}
            onPointerCancel={() => setDraft(null)}
          >
            {props.limits?.daysOff.includes(day) ? <div className={styles.limit} style={{ top: 0, bottom: 0 }} aria-hidden="true" /> : null}
            {props.limits?.earliestStart != null && props.limits.earliestStart > first * 60 ? (
              <div className={styles.limit} data-edge="start" style={{ top: 0, height: at(props.limits.earliestStart, first) }} aria-hidden="true" />
            ) : null}
            {props.limits?.latestEnd != null && props.limits.latestEnd < last * 60 ? (
              <div className={styles.limit} data-edge="end" style={{ top: at(props.limits.latestEnd, first), bottom: 0 }} aria-hidden="true" />
            ) : null}
            {busy
              .filter((block) => block.day === day)
              .map((block) => {
                const top = Math.max(block.start, first * 60);
                const bottom = Math.min(block.end, last * 60);
                if (bottom <= top) return null;
                return (
                  <div
                    key={block.id}
                    className={styles.busy}
                    data-kind={block.kind}
                    data-beside={block.beside && !phone ? "" : undefined}
                    style={{
                      top: at(top, first),
                      height: span(top, bottom),
                      ...(block.beside && !phone ? { paddingLeft: `calc(8px + (100% - 8px) * ${BESIDE_SHARE})` } : {}),
                    }}
                  >
                    {block.kind === "calendar" ? <CalendarGlyph size={12} className={styles.busyGlyph} /> : null}
                    <span className={styles.busyLabel}>{block.label}</span>
                    {block.note ? <span className={styles.busyNote} aria-hidden="true">{block.note}</span> : null}
                    <span className="sr-only-v2">
                      {block.kind === "calendar" ? ", from your calendar," : ""} busy {timeRange(block.start, block.end)}
                      {block.note ? `, ${block.note}` : ""}
                    </span>
                  </div>
                );
              })}
            {draft?.day === day && draft.from !== draft.to ? (
              <div
                className={styles.busy}
                data-draft=""
                aria-hidden="true"
                style={{ top: at(Math.min(draft.from, draft.to), first), height: span(Math.min(draft.from, draft.to), Math.max(draft.from, draft.to)) }}
              >
                {timeRange(Math.min(draft.from, draft.to), Math.max(draft.from, draft.to))}
              </div>
            ) : null}
            {events
              .filter((event) => event.day === day)
              .map((event) => {
                const placement = placements.get(event.key);
                const kept = props.kept.has(event.courseCode);
                const tall = event.end - event.start >= 40;
                const busyClash = props.busyClash?.get(event.key) ?? null;
                return (
                  <button
                    key={event.key}
                    type="button"
                    className={styles.event}
                    data-event=""
                    data-key={event.key}
                    data-hue={props.hueOf(event.courseCode)}
                    data-conflict={placement?.conflict || busyClash ? "" : undefined}
                    aria-pressed={props.selectedCourse === event.courseCode}
                    tabIndex={interactive ? 0 : -1}
                    style={{ top: at(event.start, first), height: `calc(${span(event.start, event.end)} - 2px)`, ...lane(placement, busyClash && !phone ? BESIDE_SHARE : 1) }}
                    onClick={(click) => {
                      if (swallowClick.current) {
                        swallowClick.current = false;
                        return;
                      }
                      if (interactive) props.onSelect(event, click.detail === 0);
                    }}
                    onPointerDown={(down) => onEventDown(down, event)}
                    onPointerMove={onEventMove}
                    onPointerUp={onEventUp}
                    onPointerCancel={onEventCancel}
                  >
                    {/* The name is what the event shows (WCAG 2.5.3), then the day and its state for screen readers. */}
                    <span className={styles.eventCode}>
                      <span className={styles.eventSubject}>{event.courseCode.split(" ")[0]}</span> {event.courseCode.split(" ").slice(1).join(" ")}
                    </span>{" "}
                    <span className={tall && !phone ? styles.eventTime : "sr-only-v2"}>{timeRange(event.start, event.end)}</span>
                    {busyClash && tall ? (
                      <span className={styles.eventBusy} aria-hidden="true">
                        {busyClash}
                      </span>
                    ) : null}
                    <span className="sr-only-v2">
                      , {DAY_NAME[event.day]}
                      {kept ? ", kept" : ""}
                      {placement?.conflict ? ", overlaps another class" : ""}
                      {busyClash ? `, meets during ${busyClash}` : ""}
                    </span>
                    {kept && !phone ? <LockGlyph size={13} className={styles.eventLock} /> : null}
                  </button>
                );
              })}
            {outlines
              .filter((outline) => outline.day === day)
              .map((outline) => (
                <button
                  key={`${outline.sectionId}-${outline.day}-${outline.start}`}
                  type="button"
                  className={styles.outline}
                  data-outline=""
                  data-section={outline.sectionId}
                  data-target-key={outline.targetKey}
                  data-hue={props.hueOf(outline.courseCode)}
                  data-clash={outline.clash ? "" : undefined}
                  style={{ top: at(outline.start, first), height: `calc(${span(outline.start, outline.end)} - 2px)` }}
                  aria-label={`Move ${outline.courseCode} to section ${outline.label}, ${outline.days} ${timeRange(outline.start, outline.end)}${outline.clash ? ", overlaps another class" : ""}`}
                  onClick={(click) => props.onPick(outline.courseCode, outline.sectionId, click.detail === 0)}
                >
                  §{outline.label}
                </button>
              ))}
            {walks
              .filter((walk) => walk.day === day)
              .map((walk) => {
                const gap = walk.to - walk.from;
                const words = walk.shuttle ? " min shuttle" : " min";
                // Beside a side-by-side clash, the walk runs down the middle of the lane it arrives in.
                const into = placements.get(walk.toKey);
                const left = into && into.lanes > 1 ? `calc(4px + (100% - 8px) * ${(into.lane + 0.5) / into.lanes})` : "50%";
                return (
                  <Fragment key={`${walk.fromKey}>${walk.toKey}`}>
                    <span className={styles.walkLine} data-kind={walk.kind} style={{ top: at(walk.from, first), height: span(walk.from, walk.to), left }} />
                    <span
                      className={styles.walkChip}
                      data-kind={walk.kind}
                      role="img"
                      aria-label={`${walk.minutes} minute ${walk.shuttle ? "shuttle" : "walk"} to ${walk.toCourse}, ${gap} minute break${walk.kind === "ok" ? "" : walk.kind === "tight" ? ", tight" : ", longer than the break"}`}
                      style={{ top: at(walk.from + gap / 2, first), left }}
                    >
                      {walk.shuttle ? null : <Walk size={12} />}
                      {walk.minutes}
                      <span className={styles.walkWords}>{words}</span>
                    </span>
                  </Fragment>
                );
              })}
            {ghost
              .filter((meeting) => meeting.day === day)
              .map((meeting) => (
                <div
                  key={`${meeting.day}-${meeting.start}`}
                  className={styles.ghost}
                  data-clash={meeting.clash ? "" : undefined}
                  aria-hidden="true"
                  style={{ top: at(meeting.start, first), height: `calc(${span(meeting.start, meeting.end)} - 2px)` }}
                >
                  {meeting.courseCode}
                </div>
              ))}
          </div>
        ))}
        {props.empty}
      </div>
      {props.footer}
    </section>
  );
}
