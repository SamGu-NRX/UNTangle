"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronRight, MoreGlyph, TrayIn, Undo } from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import type { Hue } from "@/lib/course-colors";
import styles from "./courses.module.css";
import { CourseRow, type RowActions } from "./CourseRow";
import type { CourseRowModel } from "./model/course-model";
import { creditsLabel } from "./model/progress";

type Props = {
  term: string;
  rows: readonly CourseRowModel[];
  colors: ReadonlyMap<string, Hue>;
  /** Tray rows whose Auto flight has not landed: hidden, and left out of the count. */
  pending: ReadonlySet<string>;
  /** Credits above which the count turns to attention. */
  budget: number;
  running: boolean;
  onAuto: (event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * "Planned 5 courses" with Undo, after an Auto run that can still be undone.
   * `hidden` holds its place unseen while rows are still landing.
   */
  result: { text: string; hidden: boolean; fresh: boolean; onUndo: (event: MouseEvent<HTMLButtonElement>) => void } | null;
  selectedId: string | null;
  actions: RowActions;
  weekHref: string;
  /** Less frequent tray actions, one step away behind ⋯. Empty hides the menu. */
  more: MenuEntry[];
  /** The one sentence an empty tray shows: where Auto's courses come from. */
  emptyText: string;
};

/**
 * The answer to "what should I take next term", first on the page: the
 * term, its credits, Auto, and the courses in it. Empty, it shows where the
 * courses will go and one sentence about Auto.
 */
export function TermTray({ term, rows, colors, pending, budget, running, onAuto, result, selectedId, actions, weekHref, more, emptyText }: Props) {
  const credits = rows.reduce((sum, row) => sum + (pending.has(row.id) ? 0 : row.credits), 0);
  const over = credits > budget;
  return (
    <section className={styles.tray} aria-labelledby="tray-title">
      <div className={styles.trayHead}>
        <div className={styles.trayHeading}>
          <h2 className={styles.trayTitle} id="tray-title">
            {term}
          </h2>
          <p className={styles.trayMeta} data-tone={over ? "attention" : undefined}>
            {over ? `${creditsLabel(credits)}, above the usual ${budget}` : creditsLabel(credits)}
          </p>
        </div>
        {more.length > 0 ? (
          <Menu
            label={`More for ${term}`}
            align="end"
            items={more}
            trigger={(props) => (
              <button {...props} type="button" className="ui-btn ui-btn--ink ui-btn--icon" aria-label={`More for ${term}`} data-ui="">
                <MoreGlyph />
              </button>
            )}
          />
        ) : null}
        <Button data-auto="" icon={<TrayIn size={18} />} loading={running} loadingLabel="Planning" onClick={onAuto}>
          Auto
        </Button>
      </div>
      {result ? (
        <p className={styles.result} data-flip="result" data-hidden={result.hidden || undefined} data-fresh={result.fresh || undefined}>
          {result.text}
          <Button variant="quiet" size="sm" icon={<Undo size={16} />} onClick={result.onUndo}>
            Undo
          </Button>
        </p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <ul className={styles.trayRows}>
            {rows.map((row) => (
              <CourseRow
                key={row.id}
                place="tray"
                row={row}
                hue={colors.get(row.id)}
                pending={pending.has(row.id)}
                selected={row.id === selectedId}
                actions={actions}
                term={term}
              />
            ))}
          </ul>
          <div className={styles.trayFoot} data-flip="tray-foot">
            <Link href={weekHref} className={styles.weekLink}>
              Open in Week
              <ChevronRight size={14} />
            </Link>
          </div>
        </>
      ) : (
        <div className={styles.trayEmpty}>
          <div className={styles.ghosts} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p>{emptyText}</p>
        </div>
      )}
    </section>
  );
}
