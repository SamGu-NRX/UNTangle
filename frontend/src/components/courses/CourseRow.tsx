"use client";

import { memo, type MouseEvent } from "react";
import { Minus, Plus } from "@/components/ui/icons";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import type { Hue } from "@/lib/course-colors";
import styles from "./courses.module.css";
import type { CourseRowModel } from "./model/course-model";
import type { RowFact } from "./model/groups";

export type RowActions = {
  open: (id: string) => void;
  add: (id: string, event: MouseEvent) => void;
  remove: (id: string, event: MouseEvent) => void;
};

type Props = {
  row: CourseRowModel;
  actions: RowActions;
  term: string;
  selected: boolean;
} & (
  | { place: "list"; factText: string | null; factTone: RowFact["tone"]; chosen: boolean }
  | { place: "tray"; hue: Hue | undefined; pending: boolean }
);

/**
 * One course: a native button that opens the detail, stretched over the row,
 * with the row's one action beside it (never inside it). A list row shows
 * its status glyph and its one fact; a tray row shows its course color and −.
 */
export const CourseRow = memo(function CourseRow(props: Props) {
  const { row, actions, term, selected } = props;
  const action =
    props.place === "tray" ? (
      <button type="button" className={styles.act} aria-label={`Remove ${row.id} from ${term}`} onClick={(event) => actions.remove(row.id, event)}>
        <Minus />
      </button>
    ) : row.status === "available" ? (
      <button type="button" className={styles.act} aria-label={`Add ${row.id} to ${term}`} onClick={(event) => actions.add(row.id, event)}>
        <Plus />
      </button>
    ) : null;

  return (
    <li
      className={styles.row}
      data-flip={`${props.place === "tray" ? "tray" : "row"}:${row.id}`}
      data-status={row.status}
      data-selected={selected || undefined}
      data-chosen={(props.place === "list" && props.chosen) || undefined}
      data-pending={(props.place === "tray" && props.pending) || undefined}
    >
      <button type="button" className={styles.rowOpen} data-row-open={row.id} aria-current={selected || undefined} onClick={() => actions.open(row.id)}>
        <span className={styles.lead} aria-hidden="true">
          {props.place === "tray" ? <span className={styles.dot} data-hue={props.hue} /> : <StatusGlyph status={row.status} />}
        </span>
        <span className={styles.code}>{row.id}</span>
        <span className={styles.title}>{row.title}</span>
        {props.place === "list" && props.factText ? (
          <span className={styles.fact} data-tone={props.factTone}>
            <span className={styles.srOnly}>, </span>
            {props.factText}
          </span>
        ) : null}
      </button>
      {action}
    </li>
  );
});
