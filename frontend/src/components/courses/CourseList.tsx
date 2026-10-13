"use client";

import { memo, useCallback, useRef } from "react";
import styles from "./courses.module.css";
import { CourseLink, ProvenanceTag, RuleText, StatusGlyph } from "./bits";
import { statusLabels, type CourseGroupModel, type CourseRowModel } from "./model/course-model";

export type RowActions = {
  open: (id: string) => void;
  plan: (id: string) => void;
  unplan: (id: string) => void;
  resetOverride: (id: string) => void;
};

type Props = {
  groups: readonly CourseGroupModel[];
  rows: ReadonlyMap<string, CourseRowModel>;
  selectedId: string | null;
  collapsed: Readonly<Record<string, boolean>>;
  onToggleGroup: (key: string) => void;
  /** ↑/↓ moved focus to this row; the panel follows when it is open. */
  onMove: (id: string) => void;
  actions: RowActions;
};

export function CourseList({ groups, rows, selectedId, collapsed, onToggleGroup, onMove, actions }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement;
      if (!target.matches("[data-row-open]")) return;
      const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row-open]") ?? [])];
      const index = buttons.indexOf(target as HTMLButtonElement);
      const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest" });
      onMove(next.dataset.rowOpen!);
    },
    [onMove],
  );

  return (
    <div ref={listRef} onKeyDown={onKeyDown}>
      {groups.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false;
        const headId = `group-${group.key}`;
        return (
          <section key={group.key} className={styles.group} aria-labelledby={headId}>
            <h2 style={{ margin: 0 }}>
              <button
                id={headId}
                type="button"
                className={styles.groupHead}
                aria-expanded={!isCollapsed}
                onClick={() => onToggleGroup(group.key)}
              >
                <svg className={styles.chev} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className={styles.gname}>{group.label}</span>
                <span className={styles.meta}>
                  {group.finished} of {group.ids.length} done
                </span>
                {group.tag ? (
                  <ProvenanceTag title="Core lists are hand-picked samples, not UNT's official degree plan.">
                    {group.tag}
                  </ProvenanceTag>
                ) : null}
              </button>
            </h2>
            {isCollapsed ? null : (
              <ul className={styles.rows}>
                {group.ids.map((id) => (
                  <CourseRow key={id} row={rows.get(id)!} selected={id === selectedId} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RowMeta({ row }: { row: CourseRowModel }) {
  switch (row.meta.kind) {
    case "grade":
      return (
        <>
          {row.meta.term} · {row.meta.grade}
        </>
      );
    case "text":
      return <>{row.meta.text}</>;
    case "via":
      return (
        <>
          Via <CourseLink id={row.meta.id} />
        </>
      );
    case "needs":
      return (
        <>
          Needs <RuleText rule={row.meta.rule} grades={false} />
        </>
      );
    default:
      return null;
  }
}

function overrideHint(row: CourseRowModel): string {
  return row.status === "done" ? "You marked this done. Click to reset." : "You planned this before its prerequisites are met. Click to reset.";
}

const CourseRow = memo(function CourseRow({
  row,
  selected,
  actions,
}: {
  row: CourseRowModel;
  selected: boolean;
  actions: RowActions;
}) {
  const label = statusLabels[row.status];
  const action =
    row.status === "available" ? (
      <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.sm}`} onClick={() => actions.plan(row.id)}>
        + Plan<span className={styles.srOnly}> {row.id}</span>
      </button>
    ) : row.status === "planned" ? (
      <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.sm}`} onClick={() => actions.unplan(row.id)}>
        Remove<span className={styles.srOnly}> {row.id} from plan</span>
      </button>
    ) : null;

  return (
    <li className={styles.row} data-status={row.status} data-selected={selected}>
      <button
        type="button"
        className={styles.rowOpen}
        data-row-open={row.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => actions.open(row.id)}
        onKeyDown={(event) => {
          if (event.key !== " ") return;
          event.preventDefault();
          if (row.status === "available") actions.plan(row.id);
          else if (row.status === "planned") actions.unplan(row.id);
        }}
      >
        <StatusGlyph status={row.status} />
        <span className={styles.code}>{row.id}</span>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowCredits}>{row.credits} cr</span>
        {/* Outside .rowCredits, which phones hide; the visible label beside the button is aria-hidden. */}
        <span className={styles.srOnly}>, {label}</span>
      </button>
      <span className={styles.rowMeta} data-row-meta data-hideable={action ? "true" : "false"}>
        <RowMeta row={row} />
      </span>
      <span className={styles.rowStatus} data-row-status>
        {row.override ? (
          <button
            type="button"
            className={styles.overrideMark}
            title={overrideHint(row)}
            aria-label={`${label}, set by you. Reset ${row.id}`}
            onClick={() => actions.resetOverride(row.id)}
          >
            {label}
          </button>
        ) : (
          <span aria-hidden="true">{label}</span>
        )}
      </span>
      {action ? <span className={styles.rowAction}>{action}</span> : null}
    </li>
  );
});
