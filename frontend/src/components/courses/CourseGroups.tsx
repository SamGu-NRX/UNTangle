"use client";

import { ChevronDown } from "@/components/ui/icons";
import styles from "./courses.module.css";
import { CourseRow, type RowActions } from "./CourseRow";
import type { CourseModel } from "./model/course-model";
import { ROWS_BEFORE_MORE, rowFact, visibleParts, type CourseGroup, type GroupKey } from "./model/groups";

type Props = {
  groups: readonly CourseGroup[];
  model: CourseModel;
  open: Readonly<Record<GroupKey, boolean>>;
  onToggle: (key: GroupKey) => void;
  expanded: Readonly<Record<GroupKey, boolean>>;
  onExpand: (key: GroupKey) => void;
  selectedId: string | null;
  /** Picked by a running Auto, tinted before they leave for the tray. */
  chosen: ReadonlySet<string>;
  actions: RowActions;
  term: string;
};

/**
 * The groups in one column, each behind a header that opens and closes it at
 * once (MOTION.md §7: no height animation). Only a closed group shows its
 * count, because that count is what decides whether to open it.
 */
export function CourseGroups({ groups, model, open, onToggle, expanded, onExpand, selectedId, chosen, actions, term }: Props) {
  return (
    <>
      {groups.map((group) => {
        const isOpen = open[group.key];
        const { parts, hidden } = expanded[group.key] ? { parts: group.parts, hidden: 0 } : visibleParts(group.parts, ROWS_BEFORE_MORE);
        const headId = `group-${group.key}`;
        return (
          <section key={group.key} className={styles.group} aria-labelledby={headId} data-open={isOpen}>
            <h2 className={styles.groupHeading} data-flip={`head:${group.key}`}>
              <button id={headId} type="button" className={styles.groupHead} aria-expanded={isOpen} onClick={() => onToggle(group.key)}>
                <span>{group.title}</span>
                {isOpen ? null : <span className={styles.count}>{group.count}</span>}
                <ChevronDown size={16} className={styles.chev} />
              </button>
            </h2>
            {isOpen ? (
              <>
                {parts.map((part, index) => (
                  <div key={part.label ?? index}>
                    {part.label ? (
                      <h3 className={styles.sub} data-flip={`sub:${group.key}:${index}`}>
                        {part.label}
                      </h3>
                    ) : null}
                    <ul className={styles.rows}>
                      {part.ids.map((id) => {
                        const row = model.rows.get(id)!;
                        const fact = rowFact(row);
                        return (
                          <CourseRow
                            key={id}
                            place="list"
                            row={row}
                            factText={fact?.text ?? null}
                            factTone={fact?.tone ?? "default"}
                            chosen={chosen.has(id)}
                            selected={id === selectedId}
                            actions={actions}
                            term={term}
                          />
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {hidden > 0 ? (
                  <button type="button" className={styles.more} data-flip={`more:${group.key}`} onClick={() => onExpand(group.key)}>
                    Show {hidden} more
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
