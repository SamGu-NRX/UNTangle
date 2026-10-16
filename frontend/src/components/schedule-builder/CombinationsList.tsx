"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import type { Section } from "@/lib/sections";
import styles from "./builder.module.css";
import type { BrowseFeed, BrowseRow } from "./host";
import { clock, eventsOf, sectionLabel, timeRange } from "./week";
import { useVirtualRows } from "./virtual-rows";

/** Every row shows every course, one or two to a line, under a line of figures. */
const ROW_PAD = 12;
const HEAD_LINE = 20;
const NAME_LINE = 18;
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/**
 * Longest "MATH 2700 001" (code plus section) that fits half a row's text
 * column on a 390px phone at 13px; a lecture with its lab ("150 + 151") takes
 * the whole line instead.
 */
const HALF_LINE_CHARS = 14;

function rowHeightFor(courseCount: number, columns: 1 | 2): number {
  return ROW_PAD * 2 + Math.max(56, HEAD_LINE + 4 + Math.ceil(courseCount / columns) * NAME_LINE);
}

const count = (n: number) => n.toLocaleString("en-US");

/** "248", or "937,570+" when the count stopped early: the strip's "12 of 248". */
export function totalCount(feed: Pick<BrowseFeed, "total" | "totalExact">): string {
  return feed.totalExact ? count(feed.total) : `${count(feed.total)}+`;
}

/** How the list is ordered and how much of it is here, in one or two sentences. */
function listSummary(feed: Pick<BrowseFeed, "rows" | "total" | "totalExact" | "proven">): string {
  const shown = feed.rows.length;
  const size = feed.total === 1 ? "1 combination fits." : `${feed.totalExact ? count(feed.total) : `At least ${count(feed.total)}`} combinations fit.`;
  const order = shown < feed.total ? ` Showing the best ${count(shown)}, ranked by your preferences.` : shown > 1 ? " Ranked by your preferences." : "";
  const proof = feed.proven ? "" : " Best found within the time limit; a better one may exist.";
  return `${size}${order}${proof}`;
}

/** A row's figures: "4 days, 8:00–2:50". */
function figures(row: BrowseRow): string {
  const days = `${row.daysOnCampus} day${row.daysOnCampus === 1 ? "" : "s"}`;
  return row.earliestStart === null || row.latestEnd === null ? days : `${days}, ${timeRange(row.earliestStart, row.latestEnd)}`;
}

/** What a screen reader hears for a row (the drawing is hidden from it). */
function spoken(row: BrowseRow, index: number, names: readonly Name[], yours: boolean): string {
  const span = row.earliestStart === null || row.latestEnd === null ? "" : `, ${clock(row.earliestStart)} to ${clock(row.latestEnd)}`;
  const sections = names.map((name) => `${name.code} section ${name.label}${name.changed ? "" : ", same as your week"}`).join("; ");
  return `Combination ${index + 1}${yours ? ", your week" : ""}: ${row.daysOnCampus} day${row.daysOnCampus === 1 ? "" : "s"}${span}. ${sections}.`;
}

type Name = { code: string; label: string; changed: boolean };

type Props = {
  feed: BrowseFeed;
  find: (courseCode: string, sectionId: string) => Section | undefined;
  hueOf: (courseCode: string) => number;
  /** The week as it is: course code -> section id. Rows mark what they change from it. */
  current: Record<string, string>;
  /** The row the list is on; the keyboard moves it. */
  active: number | null;
  /** The row the grid shows: the one under the pointer, else `active`. The only row drawn as selected. */
  previewed: number | null;
  onActive: (index: number | null) => void;
  /** The row under a fine pointer, previewed on the grid; null when the pointer leaves. */
  onHover: (index: number | null) => void;
  onChoose: (index: number, fromKeyboard: boolean) => void;
  /** Opened from the keyboard: the list takes focus when it appears, since the button that opened it is gone. */
  focusOnShow?: boolean;
};

/**
 * Browse all (docs/research/schedule-builders/README.md §5): every week that
 * fits, best first, each a small drawn week with its section names. Pointing
 * at a row previews it on the grid; the keyboard moves through the rows the
 * same way. Choosing one uses exactly its sections, as the strip's Use this
 * does.
 *
 * One listbox with aria-activedescendant, so the list is one Tab stop and a
 * screen reader hears "12 of 500" from aria-posinset/setsize even though only
 * the rows near the visible part exist (virtual-rows.ts). The row the
 * keyboard is on always stays rendered, so the active descendant exists.
 */
export function CombinationsList({ feed, find, hueOf, current, active, previewed, onActive, onHover, onChoose, focusOnShow = false }: Props) {
  const rows = feed.rows;
  const courses = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.byCourse)))].sort(), [rows]);
  // One layout for the whole list, so every row has the same height.
  const columns = useMemo<1 | 2>(() => {
    for (const row of rows) {
      for (const [code, id] of Object.entries(row.byCourse)) {
        const section = find(code, id);
        if (code.length + (section ? sectionLabel(section) : id).length > HALF_LINE_CHARS) return 1;
      }
    }
    return 2;
  }, [rows, find]);
  const rowHeight = rowHeightFor(courses.length, columns);
  const { ref, range, reveal, viewport } = useVirtualRows(rows.length, rowHeight);
  const listRef = useRef<HTMLDivElement | null>(null);
  const disabled = feed.stale || feed.status === "running";
  // Once, when the list first appears: the row it lands on (the option the strip showed) is in view,
  // and the list has focus if the keyboard opened it.
  useLayoutEffect(() => {
    if (active !== null) reveal(active);
    if (focusOnShow) listRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One time scale and one set of days for every drawn week, so rows compare at a glance.
  const scale = useMemo(() => {
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    const days = new Set<string>();
    for (const row of rows) {
      for (const [code, id] of Object.entries(row.byCourse)) {
        const section = find(code, id);
        if (!section) continue;
        for (const event of eventsOf([section])) {
          from = Math.min(from, event.start);
          to = Math.max(to, event.end);
          days.add(event.day);
        }
      }
    }
    const shownDays = WEEK_DAYS.filter((day) => (day === "Sat" || day === "Sun" ? days.has(day) : true));
    return { from: Number.isFinite(from) ? from : 480, to: Number.isFinite(to) ? to : 1020, days: shownDays };
  }, [rows, find]);

  const move = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    onActive(next);
    reveal(next);
  };
  const pageRows = () => Math.max(1, Math.floor(viewport() / rowHeight) - 1);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const at = active ?? -1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(at + 1),
      ArrowUp: () => move(at < 0 ? 0 : at - 1),
      Home: () => move(0),
      End: () => move(rows.length - 1),
      PageDown: () => move(Math.max(at, 0) + pageRows()),
      PageUp: () => move(Math.max(at, 0) - pageRows()),
      Enter: () => (at >= 0 && !disabled ? onChoose(at, true) : undefined),
      " ": () => (at >= 0 && !disabled ? onChoose(at, true) : undefined),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const indices: number[] = [];
  for (let i = range.first; i < range.last; i += 1) indices.push(i);
  if (active !== null && active < rows.length && (active < range.first || active >= range.last)) indices.push(active);

  const span = Math.max(60, scale.to - scale.from);
  const optionId = (index: number) => `combination-${index}`;

  return (
    <div
      ref={(node) => {
        ref.current = node;
        listRef.current = node;
      }}
      className={styles.combos}
      role="listbox"
      aria-label="Combinations, best first"
      aria-activedescendant={active !== null && active < rows.length ? optionId(active) : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={0}
      style={{ height: rows.length * rowHeight, "--row-h": `${rowHeight}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target !== event.currentTarget || rows.length === 0) return;
        move(active ?? 0);
      }}
      onPointerLeave={() => onHover(null)}
      // A press chooses; it doesn't focus the list. Focusing a list taller than
      // its scroller moves it (the phone sheet rises to show focus, a scroller
      // scrolls), which puts another row under the pointer before the release.
      onMouseDown={(event) => event.preventDefault()}
    >
      {indices.map((index) => {
        const row = rows[index];
        const names: Name[] = courses.flatMap((code) => {
          const id = row.byCourse[code];
          if (id === undefined) return [];
          const section = find(code, id);
          return [{ code, label: section ? sectionLabel(section) : id, changed: current[code] !== id }];
        });
        const yours = names.every((name) => !name.changed) && names.length === Object.keys(row.byCourse).length;
        const sections = names.map((name) => ({ name, section: find(name.code, row.byCourse[name.code]) }));
        return (
          <div
            key={index}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            aria-posinset={index + 1}
            aria-setsize={rows.length}
            aria-label={spoken(row, index, names, yours)}
            className={styles.combo}
            data-active={index === previewed || undefined}
            style={{ transform: `translateY(${index * rowHeight}px)` }}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") onHover(index);
            }}
            onClick={(event) => {
              if (!disabled) onChoose(index, event.detail === 0);
            }}
          >
            <span className={styles.comboRank} aria-hidden="true">
              {index + 1}
            </span>
            <span className={styles.comboWeek} aria-hidden="true" style={{ "--days": scale.days.length } as CSSProperties}>
              {scale.days.map((day) => (
                <span key={day}>
                  {sections.flatMap(({ name, section }) =>
                    section
                      ? eventsOf([section])
                          .filter((event) => event.day === day)
                          .map((event) => (
                            <i
                              key={event.key}
                              data-hue={hueOf(name.code)}
                              data-same={name.changed ? undefined : ""}
                              style={{ top: `${((event.start - scale.from) / span) * 100}%`, height: `${((event.end - event.start) / span) * 100}%` }}
                            />
                          ))
                      : [],
                  )}
                </span>
              ))}
            </span>
            <span className={styles.comboText} aria-hidden="true">
              <span className={styles.comboHead}>
                {figures(row)}
                {yours ? <span className={styles.comboYours}>Your week</span> : null}
              </span>
              <span className={styles.comboNames} data-columns={columns}>
                {names.map((name) => (
                  <span key={name.code} data-hue={hueOf(name.code)} data-same={name.changed ? undefined : ""}>
                    <b>{name.code}</b> {name.label}
                  </span>
                ))}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** What the panel says above the list, in every state: one status line that stays mounted, so changes are announced. */
function panelStatus(feed: BrowseFeed): string {
  if (feed.status === "error") return `Browse all stopped before it listed any weeks. ${feed.error ?? ""}`.trim();
  if (feed.infeasible) return `Nothing fits these preferences. ${feed.infeasible.sentence}`;
  if (feed.timedOut) return "No week turned up in time. Loosen a preference or keep fewer sections.";
  if (feed.rows.length === 0) return "Listing every combination that fits.";
  if (feed.stale || feed.status === "running") return "Updating for your new settings.";
  return listSummary(feed);
}

/** The panel's body around the list: what the list holds, or why it is empty and what to change, and the list. */
export function BrowsePanel(props: Props & { onRetry: () => void }) {
  const { feed } = props;
  const waiting = feed.status !== "error" && !feed.infeasible && !feed.timedOut && feed.rows.length === 0;
  const tone = feed.status === "error" || feed.infeasible ? "danger" : undefined;
  return (
    <>
      <p className={feed.rows.length > 0 && !feed.infeasible ? styles.comboSummary : styles.comboNote} data-tone={tone} data-loading={waiting || undefined} data-ui={waiting || undefined} role="status">
        {panelStatus(feed)}
      </p>
      {feed.status === "error" ? (
        <div className={styles.comboActions}>
          <Button variant="secondary" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      ) : feed.infeasible ? (
        feed.infeasible.fixes.length > 0 ? (
          <div className={styles.comboActions}>
            {feed.infeasible.fixes.slice(0, 3).map((fix) => (
              <Button key={fix.label} variant="secondary" size="sm" onClick={fix.apply}>
                {fix.label}
              </Button>
            ))}
          </div>
        ) : null
      ) : feed.rows.length > 0 && !feed.timedOut ? (
        <CombinationsList {...props} />
      ) : null}
    </>
  );
}
