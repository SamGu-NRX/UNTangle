"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "./anchored";
import { Chip } from "./Chip";
import { cx } from "./cx";
import {
  addDays,
  addMonths,
  compareDates,
  formatDate,
  formatLong,
  formatMonth,
  monthGrid,
  parseDateText,
  parts,
  todayISO,
  weekday,
  type ISODate,
} from "./date-utils";
import { CalendarGlyph, ChevronLeft, ChevronRight } from "./icons";
import { usePresence } from "./use-presence";

export type DateRange = { start: ISODate | null; end: ISODate | null };
export type TermPreset = { id: string; label: string; start: ISODate; end: ISODate };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Term chips that fill a whole date range in one tap. Presets come from the
 * school's configuration; this component only draws and applies them.
 */
export function TermPresets({
  presets,
  range,
  onPick,
}: {
  presets: TermPreset[];
  range: DateRange;
  onPick: (preset: TermPreset) => void;
}) {
  return (
    <div className="ui-presets" role="group" aria-label="Term dates">
      {presets.map((preset) => (
        <Chip
          key={preset.id}
          size="sm"
          selected={range.start === preset.start && range.end === preset.end}
          onSelectedChange={() => onPick(preset)}
        >
          {preset.label}
        </Chip>
      ))}
    </div>
  );
}

type PickerProps = {
  /** Accessible name of the calendar grid. */
  label: string;
  presets?: TermPreset[];
  min?: ISODate;
  max?: ISODate;
  /** Today's date; injectable for tests and screenshots. */
  today?: ISODate;
  className?: string;
} & (
  | { mode?: "single"; value: ISODate | null; onChange: (value: ISODate) => void }
  | { mode: "range"; range: DateRange; onRangeChange: (range: DateRange) => void }
);

/**
 * Month calendar (APG date picker grid). The focused day is the only tab
 * stop in the grid; arrows move a day or a week, PageUp/PageDown a month
 * (with Shift, a year), Home/End the week's ends, Enter or Space picks. In
 * range mode the first pick starts a range and the second ends it, and the
 * band previews under the pointer in between.
 */
export function DatePicker(props: PickerProps) {
  const { label, presets, min, max, className } = props;
  const today = props.today ?? todayISO();
  const isRange = props.mode === "range";
  const range: DateRange = isRange ? props.range : { start: props.value, end: null };
  const anchorDate = range.start ?? today;

  const [focused, setFocused] = useState<ISODate>(anchorDate);
  const [hover, setHover] = useState<ISODate | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const moveFocus = useRef(false);
  const headingId = useId();
  const { year, month } = parts(focused);
  const cells = monthGrid(year, month);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focused]);

  const outOfBounds = (iso: ISODate) => (min && compareDates(iso, min) < 0) || (max && compareDates(iso, max) > 0);

  const pick = (iso: ISODate) => {
    if (outOfBounds(iso)) return;
    setFocused(iso);
    if (props.mode === "range") {
      const { start, end } = props.range;
      if (!start || end) props.onRangeChange({ start: iso, end: null });
      else if (compareDates(iso, start) < 0) props.onRangeChange({ start: iso, end: start });
      else props.onRangeChange({ start, end: iso });
    } else {
      props.onChange(iso);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, () => ISODate> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekday(focused)),
      End: () => addDays(focused, 6 - weekday(focused)),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    if (moves[event.key]) {
      event.preventDefault();
      moveFocus.current = true;
      setFocused(moves[event.key]());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(focused);
    }
  };

  // The band runs from the start to the end, or to the hovered day while
  // the second pick is pending.
  const bandEnd = range.end ?? (isRange && range.start && hover && compareDates(hover, range.start) > 0 ? hover : null);

  return (
    <div className={cx("ui-datepicker", className)} data-ui="">
      {presets?.length && isRange ? (
        <TermPresets
          presets={presets}
          range={range}
          onPick={(preset) => {
            if (props.mode === "range") props.onRangeChange({ start: preset.start, end: preset.end });
            setFocused(preset.start);
          }}
        />
      ) : null}
      <div className="ui-datepicker__head">
        <button
          type="button"
          className="ui-btn ui-btn--quiet ui-btn--icon ui-datepicker__nav"
          aria-label="Previous month"
          onClick={() => setFocused(addMonths(focused, -1))}
        >
          <ChevronLeft />
        </button>
        <span id={headingId} className="ui-datepicker__month" aria-live="polite">
          {formatMonth(year, month)}
        </span>
        <button
          type="button"
          className="ui-btn ui-btn--quiet ui-btn--icon ui-datepicker__nav"
          aria-label="Next month"
          onClick={() => setFocused(addMonths(focused, 1))}
        >
          <ChevronRight />
        </button>
      </div>
      <table
        ref={gridRef}
        role="grid"
        aria-label={label}
        className="ui-datepicker__grid"
        onKeyDown={onKeyDown}
        onPointerLeave={() => setHover(null)}
      >
        <thead>
          <tr>
            {WEEKDAYS.map((d, i) => (
              <th key={d} scope="col" abbr={WEEKDAY_NAMES[i]}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, row) => (
            <tr key={row}>
              {cells.slice(row * 7, row * 7 + 7).map(({ iso, inMonth }, col) => {
                const isStart = range.start === iso;
                const isEnd = range.end === iso;
                const selected = isStart || isEnd;
                const inBand =
                  !selected && range.start && bandEnd && compareDates(iso, range.start) > 0 && compareDates(iso, bandEnd) < 0;
                // The band rounds where it meets a row edge or a picked end.
                const bandStarts = inBand && (col === 0 || addDays(iso, -1) === range.start);
                const bandEnds = inBand && (col === 6 || addDays(iso, 1) === bandEnd);
                const disabled = Boolean(outOfBounds(iso));
                return (
                  <td
                    key={iso}
                    role="gridcell"
                    tabIndex={iso === focused ? 0 : -1}
                    aria-selected={selected}
                    aria-disabled={disabled || undefined}
                    aria-current={iso === today ? "date" : undefined}
                    aria-label={formatLong(iso)}
                    className={cx(
                      "ui-day",
                      !inMonth && "ui-day--outside",
                      iso === today && "ui-day--today",
                      selected && "ui-day--selected",
                      inBand && "ui-day--band",
                      bandStarts && "ui-day--band-start",
                      bandEnds && "ui-day--band-end",
                    )}
                    onClick={() => pick(iso)}
                    onPointerEnter={() => setHover(iso)}
                  >
                    {parts(iso).day}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Why `iso` is outside [min, max], or null when it is inside. */
export function boundsError(iso: ISODate, min?: ISODate, max?: ISODate): string | null {
  if (min && max && (compareDates(iso, min) < 0 || compareDates(iso, max) > 0)) {
    return `Pick a date from ${formatDate(min)} to ${formatDate(max)}.`;
  }
  if (min && compareDates(iso, min) < 0) return `Pick a date on or after ${formatDate(min)}.`;
  if (max && compareDates(iso, max) > 0) return `Pick a date on or before ${formatDate(max)}.`;
  return null;
}

export type DateInputProps = {
  label: string;
  value: ISODate | null;
  onChange: (value: ISODate | null) => void;
  help?: ReactNode;
  error?: string | null;
  min?: ISODate;
  max?: ISODate;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  today?: ISODate;
};

/**
 * A text field that shows "Jan 20, 2027" and accepts typed dates ("1/20/27")
 * on Enter or blur; a click or the calendar button opens a DatePicker
 * popover. On coarse pointers it is a native date input in the same skin.
 */
export function DateInput({
  label,
  value,
  onChange,
  help,
  error,
  min,
  max,
  name,
  disabled,
  placeholder = "Jan 20, 2027",
  className,
  today,
}: DateInputProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const nativeId = `${baseId}-native`;
  const helpId = `${baseId}-help`;
  const popId = `${baseId}-pop`;
  const [text, setText] = useState(value ? formatDate(value) : "");
  const [lastValue, setLastValue] = useState(value);
  const [parseError, setParseError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 120);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  if (lastValue !== value) {
    setLastValue(value);
    setText(value ? formatDate(value) : "");
    setParseError(null);
  }

  useAnchoredPosition(mounted, fieldRef, popRef, { align: "start", offset: 6 });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || fieldRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const commitText = () => {
    if (!text.trim()) {
      setParseError(null);
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parseDateText(text, parts(today ?? todayISO()).year);
    if (!parsed) {
      setParseError("Enter a date like Jan 20, 2027 or 1/20/27.");
      return;
    }
    // Typed dates obey the same bounds as the calendar and the native input.
    const bounds = boundsError(parsed, min, max);
    if (bounds) {
      setParseError(bounds);
      return;
    }
    setParseError(null);
    setText(formatDate(parsed));
    if (parsed !== value) onChange(parsed);
  };

  const shownError = error ?? parseError;
  const describedBy = shownError || help ? helpId : undefined;

  return (
    <div className={cx("ui-textfield ui-dateinput", className)} data-invalid={shownError ? "" : undefined} data-ui="">
      <label htmlFor={inputId} className="ui-label">
        {label}
      </label>
      <div ref={fieldRef} className="ui-field ui-field--input ui-dateinput__fine" data-disabled={disabled ? "" : undefined}>
        <input
          ref={inputRef}
          id={inputId}
          className="ui-field__input"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          // APG date picker combobox: a textbox that opens a calendar dialog.
          role="combobox"
          aria-autocomplete="none"
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          onChange={(event) => setText(event.target.value)}
          onClick={() => setOpen(true)}
          onBlur={(event) => {
            if (popRef.current?.contains(event.relatedTarget as Node)) return;
            commitText();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitText();
              setOpen(false);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "ArrowDown" && (open || event.altKey)) {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus());
            }
          }}
        />
        <button
          type="button"
          className="ui-dateinput__button"
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          tabIndex={-1}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
        >
          <CalendarGlyph />
        </button>
      </div>
      <div className="ui-field ui-field--input ui-dateinput__coarse" data-disabled={disabled ? "" : undefined}>
        <input
          id={nativeId}
          type="date"
          className="ui-field__input"
          aria-label={label}
          aria-describedby={describedBy}
          value={value ?? ""}
          min={min}
          max={max}
          name={name}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
        />
      </div>
      {shownError ? (
        <p id={helpId} className="ui-help ui-help--error">
          {shownError}
        </p>
      ) : help ? (
        <p id={helpId} className="ui-help">
          {help}
        </p>
      ) : null}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              id={popId}
              role="dialog"
              aria-label={label}
              className="ui-pop ui-pop--calendar"
              data-state={state}
              data-ui=""
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  inputRef.current?.focus();
                }
              }}
            >
              <DatePicker
                label={label}
                value={value}
                min={min}
                max={max}
                today={today}
                onChange={(iso) => {
                  onChange(iso);
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
