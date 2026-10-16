"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { MoonGlyph, SunriseGlyph } from "@/components/ui/icons";
import type { SchedulePreferences, WeekDay } from "@/lib/types";
import { GRID_END, GRID_START, isBusy, isWeekly, paint, STEP, toggleDayOff, UNNAMED, withHours } from "./limits";
import styles from "./prefs.module.css";
import { WEEKDAYS } from "./preferences";
import { clockWithSuffix, DAY_NAME } from "./week";

const ROWS = (GRID_END - GRID_START) / STEP;
const PLURAL: Record<WeekDay, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays" };
/** A touch held this long paints instead of scrolling. */
const HOLD_MS = 320;
/** A touch that moves farther than this before the hold is a scroll. */
const SLOP = 8;

type Cell = { d: number; r: number };
type CSSVars = CSSProperties & { [property: `--${string}`]: string | number };

const pct = (minutes: number) => `${((minutes - GRID_START) / (GRID_END - GRID_START)) * 100}%`;
const minutesOf = (r: number) => GRID_START + r * STEP;

/** A named busy time's hue, stable per name; unnamed time is hatched instead. */
function hueFor(label: string): number {
  const k = label.trim().toLowerCase();
  if (/work|job|shift/.test(k)) return 2;
  if (/lunch|eat/.test(k)) return 4;
  if (/practice|gym|run/.test(k)) return 6;
  let x = 0;
  for (const c of k) x = (x * 31 + c.charCodeAt(0)) % 997;
  return [2, 4, 5, 6, 3][x % 5];
}

type Props = {
  preferences: SchedulePreferences;
  onChange: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  newId: () => string;
  /** Phones: taller rows, and a hold before a drag paints so the sheet still scrolls. */
  touch: boolean;
};

/**
 * Times Auto never uses, painted on a small week (r3 mockup): drag across
 * time to block it (starting on blocked time frees instead), tap a day to
 * take it off, and drag the sun and moon to set class hours. On touch, a tap
 * toggles one half hour and a press-and-hold starts a drag, so a swipe still
 * scrolls the sheet. Arrow keys move a cell cursor and Space toggles it.
 */
export function PaintGrid({ preferences: p, onChange, newId, touch }: Props) {
  const c = p.constraints;
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ anchor: Cell; cur: Cell; mode: "busy" | "free" } | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>({ d: 0, r: 2 });
  const [knob, setKnob] = useState<"start" | "end" | null>(null);
  /** The cell cursor shows, and is announced, only while the keyboard drives the grid. */
  const [kbd, setKbd] = useState(false);
  const press = useRef<{ id: number; x: number; y: number; cell: Cell; timer: number; painting: boolean } | null>(null);

  const cellAt = (x: number, y: number): Cell => {
    const rect = body.current!.getBoundingClientRect();
    return {
      d: Math.max(0, Math.min(4, Math.floor(((x - rect.left) / rect.width) * 5))),
      r: Math.max(0, Math.min(ROWS - 1, Math.floor(((y - rect.top) / rect.height) * ROWS))),
    };
  };

  const commit = (anchor: Cell, cur: Cell, mode: "busy" | "free") => {
    const d0 = Math.min(anchor.d, cur.d);
    const d1 = Math.max(anchor.d, cur.d);
    const r0 = Math.min(anchor.r, cur.r);
    const r1 = Math.max(anchor.r, cur.r) + 1;
    onChange((q) => paint(q, WEEKDAYS.slice(d0, d1 + 1), minutesOf(r0), minutesOf(r1), mode, newId));
  };
  const modeAt = (cell: Cell) => (isBusy(p, WEEKDAYS[cell.d], minutesOf(cell.r)) ? "free" : "busy");

  // While a held touch paints, the sheet must not scroll under it.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const stop = (event: TouchEvent) => {
      if (press.current?.painting) event.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The sheet around the grid would take this press as a drag of the sheet.
    event.stopPropagation();
    setKbd(false);
    const cell = cellAt(event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      const timer = window.setTimeout(() => {
        if (!press.current) return;
        press.current.painting = true;
        body.current?.setPointerCapture(press.current.id);
        setDrag({ anchor: cell, cur: cell, mode: modeAt(cell) });
        navigator.vibrate?.(8);
      }, HOLD_MS);
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, cell, timer, painting: false };
      return;
    }
    event.preventDefault();
    body.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setHover(null);
    setDrag({ anchor: cell, cur: cell, mode: modeAt(cell) });
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const t = press.current;
    if (t && !t.painting && Math.hypot(event.clientX - t.x, event.clientY - t.y) > SLOP) {
      window.clearTimeout(t.timer);
      press.current = null;
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (drag) {
      if (cell.d !== drag.cur.d || cell.r !== drag.cur.r) setDrag({ ...drag, cur: cell });
    } else if (event.pointerType === "mouse") setHover(cell);
  };
  const onUp = () => {
    const t = press.current;
    if (t) {
      window.clearTimeout(t.timer);
      press.current = null;
      // A quick tap toggles the half hour it landed on.
      if (!t.painting) {
        commit(t.cell, t.cell, modeAt(t.cell));
        return;
      }
    }
    if (drag) commit(drag.anchor, drag.cur, drag.mode);
    setDrag(null);
  };
  const onCancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const m = move[event.key];
    if (m || event.key === " " || event.key === "Enter") setKbd(true);
    if (m) {
      event.preventDefault();
      setCursor({ d: Math.max(0, Math.min(4, cursor.d + m[0])), r: Math.max(0, Math.min(ROWS - 1, cursor.r + m[1])) });
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      commit(cursor, cursor, modeAt(cursor));
    }
  };

  // The knobs: pointer drags snap to the half hour; arrows step it.
  const knobDown = (event: ReactPointerEvent<HTMLButtonElement>, edge: "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setKnob(edge);
  };
  const knobMove = (event: ReactPointerEvent<HTMLButtonElement>, edge: "start" | "end") => {
    if (knob !== edge || !body.current) return;
    const rect = body.current.getBoundingClientRect();
    const minutes = GRID_START + ((event.clientY - rect.top) / rect.height) * (GRID_END - GRID_START);
    onChange((q) => withHours(q, edge, minutes));
  };
  const knobKey = (event: KeyboardEvent<HTMLButtonElement>, edge: "start" | "end", value: number) => {
    const by = { ArrowUp: -STEP, ArrowLeft: -STEP, ArrowDown: STEP, ArrowRight: STEP, PageUp: -120, PageDown: 120 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    onChange((q) => withHours(q, edge, value + by));
  };

  const start = c.earliestStart ?? GRID_START;
  const end = c.latestEnd ?? GRID_END;

  const preview = drag
    ? {
        d0: Math.min(drag.anchor.d, drag.cur.d),
        d1: Math.max(drag.anchor.d, drag.cur.d),
        r0: Math.min(drag.anchor.r, drag.cur.r),
        r1: Math.max(drag.anchor.r, drag.cur.r) + 1,
        mode: drag.mode,
      }
    : null;

  const hours = Array.from({ length: (GRID_END - GRID_START) / 60 }, (_, i) => GRID_START + i * 60).filter((m, i) => touch || i % 2 === 0);

  return (
    <div className={styles.paint} data-touch={touch ? "" : undefined} style={{ "--rows": ROWS } as CSSVars}>
      <div />
      <div className={styles.paintDays}>
        {WEEKDAYS.map((day) => {
          const off = c.daysOff.includes(day);
          return (
            <button key={day} type="button" className={styles.paintDay} aria-pressed={off} aria-label={`${PLURAL[day]} off`} onClick={() => onChange((q) => toggleDayOff(q, day))}>
              <span>{day}</span>
              <small aria-hidden="true">Off</small>
            </button>
          );
        })}
      </div>
      <div className={styles.paintGutter}>
        {hours.map((m) => (
          <span key={m} style={{ top: pct(m) }} aria-hidden="true">
            {m === GRID_START || m === 720 ? clockWithSuffix(m) : String(Math.floor(m / 60) % 12 || 12)}
          </span>
        ))}
        <button
          type="button"
          className={styles.knob}
          role="slider"
          aria-label="Earliest class start"
          aria-valuemin={GRID_START}
          aria-valuemax={GRID_END}
          aria-valuenow={start}
          aria-valuetext={start === GRID_START ? "Any time" : clockWithSuffix(start)}
          data-active={knob === "start" ? "" : undefined}
          style={{ top: pct(start) }}
          onPointerDown={(e) => knobDown(e, "start")}
          onPointerMove={(e) => knobMove(e, "start")}
          onPointerUp={() => setKnob(null)}
          onPointerCancel={() => setKnob(null)}
          onKeyDown={(e) => knobKey(e, "start", start)}
        >
          <SunriseGlyph size={14} />
        </button>
        <button
          type="button"
          className={styles.knob}
          role="slider"
          aria-label="Latest class end"
          aria-valuemin={GRID_START}
          aria-valuemax={GRID_END}
          aria-valuenow={end}
          aria-valuetext={end === GRID_END ? "Any time" : clockWithSuffix(end)}
          data-active={knob === "end" ? "" : undefined}
          style={{ top: pct(end) }}
          onPointerDown={(e) => knobDown(e, "end")}
          onPointerMove={(e) => knobMove(e, "end")}
          onPointerUp={() => setKnob(null)}
          onPointerCancel={() => setKnob(null)}
          onKeyDown={(e) => knobKey(e, "end", end)}
        >
          <MoonGlyph size={14} />
        </button>
      </div>
      <div
        ref={body}
        className={styles.paintBody}
        tabIndex={0}
        role="application"
        aria-label={`Times you can't have class. ${touch ? "Tap a half hour to block it, or press and hold, then drag." : "Drag over times to block them."} Arrow keys move, Space blocks or frees a half hour.`}
        data-painting={drag ? "" : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setKbd(false)}
        onKeyDown={onKey}
      >
        <div className={styles.outside} data-edge="top" style={{ height: pct(start) }} />
        <div className={styles.outside} data-edge="bottom" style={{ top: pct(end) }} />
        {WEEKDAYS.map((day, d) => (c.daysOff.includes(day) ? <div key={day} className={styles.dayOff} style={{ left: `${d * 20}%` }} /> : null))}
        {c.blocked.filter(isWeekly).map((b) => {
          const d = WEEKDAYS.indexOf(b.day);
          if (d < 0) return null;
          const s = Math.max(GRID_START, b.start);
          const e = Math.min(GRID_END, b.end);
          if (e <= s) return null;
          const named = b.label !== UNNAMED;
          const showLabel = named && e - s >= (touch ? 60 : 60);
          return (
            <div
              key={b.id}
              className={styles.block}
              data-named={named ? "" : undefined}
              data-hue={named ? hueFor(b.label) : undefined}
              style={{ left: `${d * 20}%`, top: pct(s), height: `calc(${pct(e)} - ${pct(s)})` }}
              aria-hidden="true"
            >
              <span>{showLabel ? b.label : ""}</span>
            </div>
          );
        })}
        {preview ? (
          <div
            className={styles.preview}
            data-mode={preview.mode}
            aria-hidden="true"
            style={{ left: `${preview.d0 * 20}%`, width: `${(preview.d1 - preview.d0 + 1) * 20}%`, top: pct(minutesOf(preview.r0)), height: `calc(${pct(minutesOf(preview.r1))} - ${pct(minutesOf(preview.r0))})` }}
          />
        ) : null}
        {start > GRID_START ? <div className={styles.edge} style={{ top: pct(start) }} /> : null}
        {end < GRID_END ? <div className={styles.edge} style={{ top: pct(end) }} /> : null}
        {hover && !drag ? <div className={styles.cellHover} style={{ left: `${hover.d * 20}%`, top: pct(minutesOf(hover.r)) }} /> : null}
        {kbd ? <div className={styles.cellCursor} style={{ left: `${cursor.d * 20}%`, top: pct(minutesOf(cursor.r)) }} aria-hidden="true" /> : null}
        <span className="sr-only-v2" aria-live="polite">
          {kbd ? `${DAY_NAME[WEEKDAYS[cursor.d]]} ${clockWithSuffix(minutesOf(cursor.r))}, ${isBusy(p, WEEKDAYS[cursor.d], minutesOf(cursor.r)) ? "blocked" : "free"}` : ""}
        </span>
      </div>
    </div>
  );
}
