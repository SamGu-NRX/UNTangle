"use client";

import Link from "next/link";
import { useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { Check } from "@/components/ui/icons";
import { PathLine, PathStop } from "@/components/ui/PathLine";
import type { Hue } from "@/lib/course-colors";
import { beforeAuto } from "@/lib/plan-library/versions";
import { eventsOf, overlayBlocks, weekBlocks, type PlacedBlock } from "@/lib/plan-library/week";
import { resolveSectionReferences } from "@/lib/plan-library/snapshot";
import type { PlannerState } from "@/lib/types";
import type { Entry } from "./schedules-client";
import { lockChangeLines, skippedSectionLines, versionTime } from "./view-model";
import { diffLibraryPlans } from "@/lib/plan-library/diff";
import { WeekGrid } from "./week-grid";
import styles from "./library.module.css";

const VERSION_LABELS = { faded: "Only now", dashed: "Only before Auto" } as const;

/**
 * One schedule in the panel (DESIGN.md §4.5 Detail): what to do with it,
 * its week, and for Main its history on the path line. Picking a version
 * draws it over the week, dashed where it differs; Restore puts it back
 * in one step that can be undone. A saved copy offers "Use in Main"
 * instead, with a line first when Main has no saved copy to come back to.
 */
export function ScheduleDetail({
  entry,
  colors,
  now,
  mainSaved,
  onUse,
  onSaveMain,
  onExport,
  onRestore,
}: {
  entry: Entry;
  colors: ReadonlyMap<string, Hue>;
  now: Date;
  /** Whether Main already has a saved copy. */
  mainSaved: boolean;
  onUse: () => void;
  onSaveMain: () => void;
  onExport: () => void;
  onRestore: (pick: (current: PlannerState) => PlannerState | null, label: string) => void;
}) {
  const { sectionCatalog, candidateFilter, plannerState } = usePlanner();
  const [version, setVersion] = useState<"now" | "before-auto">("now");
  const before = entry.active ? beforeAuto(entry.state) : null;
  const shownVersion = before ? version : "now";
  const versionBlocks = shownVersion === "before-auto" && before ? weekBlocks(eventsOf(before.state, sectionCatalog, candidateFilter)) : null;
  const items = overlayBlocks(entry.blocks, versionBlocks);
  const skipped = entry.snapshot
    ? [
        ...skippedSectionLines(resolveSectionReferences(entry.snapshot.state, sectionCatalog)),
        ...lockChangeLines(diffLibraryPlans(entry.snapshot.state, plannerState, sectionCatalog).lockChanges),
      ]
    : [];

  return (
    <div className={styles.detail}>
      <div className={styles.detailActions}>
        {entry.active ? (
          <>
            <Link href="/schedule" className="ui-btn ui-btn--primary ui-btn--sm" data-ui="">
              Open in Week
            </Link>
            <Button variant="secondary" size="sm" onClick={onSaveMain}>
              Save a copy
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={onUse}>
              Use in Main
            </Button>
            <Button variant="secondary" size="sm" onClick={onExport}>
              Export file
            </Button>
          </>
        )}
      </div>
      {!entry.active && !mainSaved ? (
        <p className={styles.warn}>
          Main has no saved copy yet.{" "}
          <button type="button" className={styles.inline} onClick={onSaveMain}>
            Save a copy first
          </button>
        </p>
      ) : null}
      {skipped.length ? (
        <ul className={styles.warnList} aria-label="What Use in Main changes beyond the week">
          {skipped.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <WeekGrid items={items} colors={colors} layout={shownVersion} animate={false} labels={versionBlocks ? VERSION_LABELS : undefined} />
      {versionBlocks ? <Legend items={items} labels={VERSION_LABELS} /> : null}

      {before ? (
        <section className={styles.history} aria-labelledby="history-title">
          <h3 id="history-title" className={styles.sectionTitle}>
            History
          </h3>
          <PathLine label="History">
            <PathStop marker={<Check size={14} />} leg="past">
              <div className={styles.versionRow}>
                <VersionButton pressed={shownVersion === "now"} onClick={() => setVersion("now")} title="Now" meta={versionTime(entry.state.updatedAt, now)} />
              </div>
            </PathStop>
            <PathStop tone="ring">
              <div className={styles.versionRow}>
                <VersionButton
                  pressed={shownVersion === "before-auto"}
                  onClick={() => setVersion("before-auto")}
                  title="Before Auto"
                  meta={versionTime(before.at, now)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Restore Before Auto"
                  onClick={() => onRestore((current) => beforeAuto(current)?.state ?? null, "Before Auto")}
                >
                  Restore
                </Button>
              </div>
            </PathStop>
          </PathLine>
        </section>
      ) : null}
    </div>
  );
}

/** Names only the kinds of block the grid is showing. */
export function Legend({ items, labels }: { items: readonly PlacedBlock[]; labels: Partial<Record<PlacedBlock["variant"], string>> }) {
  const shown = (["solid", "faded", "dashed"] as const).filter((variant) => labels[variant] && items.some((item) => item.variant === variant));
  if (!shown.length) return null;
  return (
    <div className={styles.legend}>
      {shown.map((variant) => (
        <span key={variant}>
          <i data-variant={variant} />
          {labels[variant]}
        </span>
      ))}
    </div>
  );
}

function VersionButton({ pressed, onClick, title, meta }: { pressed: boolean; onClick: () => void; title: string; meta: string }) {
  return (
    <button type="button" className={styles.version} aria-pressed={pressed} onClick={onClick}>
      <strong>{title}</strong>
      <span>{meta}</span>
    </button>
  );
}
