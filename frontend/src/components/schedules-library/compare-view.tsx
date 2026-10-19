"use client";

import { useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { ChevronRight } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Segmented } from "@/components/ui/Segmented";
import type { Hue } from "@/lib/course-colors";
import { describeOtherDifferences, diffLibraryPlans } from "@/lib/plan-library/diff";
import { buildScheduleEvents } from "@/lib/planner";
import { compareRows, overlayBlocks, plannedCredits, plannedSections, resolveAsMain, sectionChanges, sectionGrid, weekStats, type PlacedBlock } from "@/lib/plan-library/week";
import type { ScheduleEvent } from "@/lib/types";
import type { Entry } from "./schedules-client";
import { Legend } from "./schedule-detail";
import { UnsavedMainNote } from "./unsaved-main-note";
import { adoptableSide, samePlan, weekWalking } from "./view-model";
import { WeekGrid } from "./week-grid";
import styles from "./library.module.css";

export type CompareSide = Entry;
type View = "a" | "both" | "b" | "c";

/** Most plans Compare shows at once: A, read against by B and C. */
export const MAX_COMPARED = 3;

/**
 * Two or three schedules side by side (DESIGN.md §4.5 Compare). With two:
 * A, Both or B on one week, where Both draws B dashed only where it differs
 * and the classes that move glide between views. With three: A, B or C,
 * gliding the same way; an overlay of three weeks would be unreadable. Then
 * the figures, credits first (better in brand, worse in attention, in words
 * too, each against A), the sections that change, the ones that don't, and
 * the way to use the plan on screen. The rest of #37's comparison (statuses,
 * claimed credit, Auto, locks, goal and major) sits behind "More differences".
 */
export function CompareView({
  sides,
  colors,
  mainSaved,
  onUse,
  onSaveMain,
  onDone,
}: {
  sides: readonly CompareSide[];
  colors: ReadonlyMap<string, Hue>;
  /** Whether Main already has a saved copy. */
  mainSaved: boolean;
  onUse: (entry: CompareSide) => void;
  onSaveMain: () => void;
  onDone: () => void;
}) {
  const { plannerState, scheduleEvents, sectionCatalog, sectionPlan, candidateFilter, evidenceHundredths } = usePlanner();
  const [chosenView, setView] = useState<View>("both");
  const [fromPointer, setFromPointer] = useState(true);
  const [showMore, setShowMore] = useState(false);

  if (sides.length < 2) {
    return <p className={styles.quiet}>Pick {sides.length ? "one or two more schedules" : "two or three schedules"} from the list.</p>;
  }
  const [a, b, c] = sides;
  const three = c !== undefined;
  // "Both" exists only for two plans; with a third the view falls back to A.
  const view: View = three && chosenView === "both" ? "a" : !three && chosenView === "c" ? "both" : chosenView;
  // Each side's sections, resolved once: Main's as Week resolves them, a copy's against the sections
  // loaded now with Main's filter and evidence, which Use in Main keeps.
  const figures = (side: CompareSide) => {
    const plan = side.active ? sectionPlan : resolveAsMain(side.state, sectionCatalog, candidateFilter, evidenceHundredths);
    const events: ScheduleEvent[] = side.active ? scheduleEvents : buildScheduleEvents(plan);
    const placed = plan.courses.flatMap((course) => (course.section ? [course.section] : []));
    return { ...weekStats(events), ...weekWalking(placed), credits: plannedCredits(side.state) };
  };
  // A long name ends in an ellipsis inside its segment (ui.css .ui-seg__label); the title shows it whole on hover.
  const named = (side: CompareSide) => <span title={side.name}>{side.name}</span>;
  const base = figures(a);
  // One column per plan after A, each judged against A.
  const columns = sides.slice(1).map((side) => compareRows(base, figures(side)));
  const rows = columns[0].map((row, i) => ({ label: row.label, a: row.a, others: columns.map((column) => ({ value: column[i].b, verdict: column[i].verdict })) }));
  // From the plans, not the drawn blocks, so an online or TBA section's change still shows.
  const planned = sides.map((side) => plannedSections(side.state, sectionCatalog, candidateFilter, evidenceHundredths));
  const { changes, same } = sectionChanges(planned[0], planned[1]);
  const grid = sectionGrid(planned);
  // Statuses, claimed credit, Auto, locks, goal and major: one step away, behind "More differences".
  // One group per plan read against A, so "in A only" stays true of the pair it names.
  const more = sides
    .slice(1)
    .map((side) => ({ side, lines: describeOtherDifferences(diffLibraryPlans(a.state, side.state, sectionCatalog), a.name, side.name) }))
    .filter((group) => group.lines.length > 0);
  const moreCount = more.reduce((sum, group) => sum + group.lines.length, 0);
  const shownSide = view === "b" ? b : view === "c" && c ? c : a;
  // Both: A solid, and B dashed where it differs (A's own classes are not faded here).
  const items: PlacedBlock[] =
    view === "both"
      ? overlayBlocks(a.blocks, b.blocks).map((item) => (item.variant === "faded" ? { ...item, variant: "solid" } : item))
      : shownSide.blocks.map((block) => ({ ...block, id: block.key, variant: "solid" }));

  // With three, Use follows the plan on screen; with two, it is the one that isn't Main.
  // A copy that holds what Main already holds has nothing to use.
  const candidate = three ? (shownSide.active ? null : shownSide) : adoptableSide(a, b);
  const adoptable = candidate && !samePlan(candidate.state, plannerState) ? candidate : null;
  const bothLabels = { solid: a.name, dashed: `${b.name}, where it differs` };
  const others = sides.slice(1);

  return (
    <div className={styles.detail}>
      <div className={styles.detailActions}>
        {adoptable ? (
          <Button size="sm" onClick={() => onUse(adoptable)}>
            Use {adoptable.name} in Main
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
      {adoptable && !mainSaved ? <UnsavedMainNote onSaveMain={onSaveMain} /> : null}
      <div
        // Segmented reports keyboard use itself; a click with detail 0 is a keyboard press too.
        onPointerDownCapture={() => setFromPointer(true)}
        onKeyDownCapture={() => setFromPointer(false)}
      >
        <Segmented
          label="Show"
          size="sm"
          fullWidth
          value={view}
          onValueChange={setView}
          options={
            three
              ? [
                  { value: "a", label: named(a) },
                  { value: "b", label: named(b) },
                  { value: "c", label: named(c) },
                ]
              : [
                  { value: "a", label: named(a) },
                  { value: "both", label: "Both" },
                  { value: "b", label: named(b) },
                ]
          }
        />
      </div>
      <WeekGrid items={items} colors={colors} layout={view} animate={fromPointer && !keyboardFocused()} labels={view === "both" ? bothLabels : undefined} />
      {view === "both" ? <Legend items={items} labels={bothLabels} /> : null}

      <table className={styles.table}>
        <caption className="sr-only-v2">
          {others.map((side) => side.name).join(" and ")} compared with {a.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only-v2">Figure</span>
            </th>
            {sides.map((side) => (
              <th key={side.id} scope="col">
                {side.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.a}</td>
              {row.others.map((cell, i) => (
                <td key={others[i].id} data-verdict={cell.verdict}>
                  {cell.value}
                  {cell.verdict === "better" || cell.verdict === "worse" ? (
                    <span className="sr-only-v2">
                      , {cell.verdict}
                      {three ? ` than ${a.name}` : ""}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {three ? (
        grid.rows.length ? (
          <section aria-labelledby="changes-title">
            <h3 id="changes-title" className={styles.sectionTitle}>
              Sections that change
            </h3>
            <table className={styles.table} data-sections="">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only-v2">Course</span>
                  </th>
                  {sides.map((side) => (
                    <th key={side.id} scope="col">
                      {side.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.code}>
                    <th scope="row">
                      <span className={styles.cdot} aria-hidden="true" style={{ "--c": `var(--c${colors.get(row.code) ?? 1})` } as React.CSSProperties} />
                      <span className="ui-code">{row.code}</span>
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={sides[i].id} data-differs={i > 0 && row.ids[i] !== row.ids[0] ? "" : undefined}>
                        {cell ?? `Not in ${sides[i].name}`}
                        {i > 0 && row.ids[i] !== row.ids[0] ? <span className="sr-only-v2">, differs from {a.name}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <p className={styles.quiet}>Every section is the same in all three.</p>
        )
      ) : changes.length ? (
        <section aria-labelledby="changes-title">
          <h3 id="changes-title" className={styles.sectionTitle}>
            Sections that change
          </h3>
          <ul className={styles.changes}>
            {changes.map((change) => (
              <li key={change.code} style={{ "--c": `var(--c${colors.get(change.code) ?? 1})` } as React.CSSProperties}>
                <span className={styles.cdot} aria-hidden="true" />
                <span className="ui-code">{change.code}</span>
                <span>
                  <s className={styles.from}>{change.from ?? `Not in ${a.name}`}</s>
                  <ChevronRight size={14} className={styles.arrow} />
                  <span className="sr-only-v2"> becomes </span>
                  {change.to ?? `Not in ${b.name}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className={styles.quiet}>Every section is the same in both.</p>
      )}
      {three ? (
        grid.same.length && grid.rows.length ? <p className={styles.quiet}>Same in all three: {grid.same.join(", ")}.</p> : null
      ) : same.length && changes.length ? (
        <p className={styles.quiet}>Same in both: {same.join(", ")}.</p>
      ) : null}
      {moreCount ? (
        <section>
          <button type="button" className={styles.groupToggle} aria-expanded={showMore} onClick={() => setShowMore((on) => !on)}>
            More differences
            {showMore ? null : <span className={styles.count}>{moreCount}</span>}
          </button>
          {showMore
            ? more.map(({ side, lines }) => (
                <div key={side.id}>
                  {three ? (
                    <h4 className={styles.moreTitle}>
                      {a.name} and {side.name}
                    </h4>
                  ) : null}
                  <ul className={styles.moreList}>
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))
            : null}
        </section>
      ) : null}
    </div>
  );
}
