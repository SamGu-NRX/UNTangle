"use client";

import { useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { ChevronRight } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import type { Hue } from "@/lib/course-colors";
import { describeOtherDifferences, diffLibraryPlans } from "@/lib/plan-library/diff";
import { compareRows, eventsOf, overlayBlocks, plannedSections, sectionChanges, weekStats, type PlacedBlock } from "@/lib/plan-library/week";
import type { ScheduleEvent } from "@/lib/types";
import type { Entry } from "./schedules-client";
import { Legend } from "./schedule-detail";
import { WeekGrid } from "./week-grid";
import styles from "./library.module.css";

export type CompareSide = Entry;
type View = "a" | "both" | "b";

/**
 * Two schedules side by side (DESIGN.md §4.5 Compare): A, Both or B on one
 * week, where Both draws B dashed only where it differs and the classes
 * that move glide between views. Then the figures (better in brand, worse
 * in attention, in words too), the sections that change, the ones that
 * don't, and the way to use B. The rest of #37's comparison (statuses,
 * claimed credit, Auto, locks, goal and major) sits behind "More differences".
 */
export function CompareView({
  sides,
  colors,
  onUse,
  onDone,
}: {
  sides: readonly CompareSide[];
  colors: ReadonlyMap<string, Hue>;
  onUse: (entry: CompareSide) => void;
  onDone: () => void;
}) {
  const { scheduleEvents, sectionCatalog } = usePlanner();
  const [view, setView] = useState<View>("both");
  const [fromPointer, setFromPointer] = useState(true);
  const [showMore, setShowMore] = useState(false);

  if (sides.length < 2) {
    return <p className={styles.quiet}>Pick {sides.length ? "one more schedule" : "two schedules"} from the list.</p>;
  }
  const [a, b] = sides;
  const events = (side: CompareSide): ScheduleEvent[] => (side.active ? scheduleEvents : eventsOf(side.state, sectionCatalog));
  const rows = compareRows(weekStats(events(a)), weekStats(events(b)));
  // From the plans, not the drawn blocks, so an online or TBA section's change still shows.
  const { changes, same } = sectionChanges(plannedSections(a.state, sectionCatalog), plannedSections(b.state, sectionCatalog));
  // Statuses, claimed credit, Auto, locks, goal and major: one step away, behind "More differences".
  const more = describeOtherDifferences(diffLibraryPlans(a.state, b.state, sectionCatalog), a.name, b.name);
  // Both: A solid, and B dashed where it differs (A's own classes are not faded here).
  const items: PlacedBlock[] =
    view === "both"
      ? overlayBlocks(a.blocks, b.blocks).map((item) => (item.variant === "faded" ? { ...item, variant: "solid" } : item))
      : (view === "a" ? a.blocks : b.blocks).map((block) => ({ ...block, id: block.key, variant: "solid" }));

  const bothLabels = { solid: a.name, dashed: `${b.name}, where it differs` };

  return (
    <div className={styles.detail}>
      <div className={styles.detailActions}>
        {b.active ? null : (
          <Button size="sm" onClick={() => onUse(b)}>
            Use {b.name} in Main
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
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
          options={[
            { value: "a", label: a.name },
            { value: "both", label: "Both" },
            { value: "b", label: b.name },
          ]}
        />
      </div>
      <WeekGrid items={items} colors={colors} layout={view} animate={fromPointer} labels={view === "both" ? bothLabels : undefined} />
      {view === "both" ? <Legend items={items} labels={bothLabels} /> : null}

      <table className={styles.table}>
        <caption className="sr-only-v2">
          {b.name} compared with {a.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only-v2">Figure</span>
            </th>
            <th scope="col">{a.name}</th>
            <th scope="col">{b.name}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.a}</td>
              <td data-verdict={row.verdict}>
                {row.b}
                {row.verdict === "same" ? null : <span className="sr-only-v2">, {row.verdict}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {changes.length ? (
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
      {same.length && changes.length ? <p className={styles.quiet}>Same in both: {same.join(", ")}.</p> : null}
      {more.length ? (
        <section>
          <button type="button" className={styles.groupToggle} aria-expanded={showMore} onClick={() => setShowMore((on) => !on)}>
            More differences
            {showMore ? null : <span className={styles.count}>{more.length}</span>}
          </button>
          {showMore ? (
            <ul className={styles.moreList}>
              {more.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
