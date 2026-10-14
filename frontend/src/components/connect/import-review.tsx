import { useId, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import {
  checkReason,
  creditLine,
  importSelection,
  reviewGroups,
  rowFact,
  termLabel,
  type CheckDecision,
} from "@/lib/connect/review";
import type { TranscriptReconcileResult } from "@/lib/transcript-import";
import styles from "./connect.module.css";

const CHECK_OPTIONS: Array<{ value: CheckDecision; label: string }> = [
  { value: "completed", label: "Done" },
  { value: "inProgress", label: "Taking" },
  { value: "ignored", label: "Skip" },
];

/**
 * The review step (DESIGN.md §4.1 `review`): how many courses were found,
 * one line of credits, then the rows the student must decide ("To check")
 * and every other row under its term. A row is a code, a title and one
 * fact; the credits live only in the summary line. "Looks right" saves the
 * settled rows and every checked row counted as Done or Taking.
 */
export function ImportReview({
  result,
  decisions,
  onDecide,
  headingRef,
  canSave,
  onSave,
  onChooseAnother,
  conflictNotice,
}: {
  result: TranscriptReconcileResult;
  decisions: Readonly<Record<string, CheckDecision>>;
  onDecide: (recordId: string, decision: CheckDecision) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  canSave: boolean;
  onSave: () => void;
  onChooseAnother: () => void;
  /** Shown when another tab saved a newer schedule: it has to be settled before saving. */
  conflictNotice: ReactNode;
}) {
  const { toCheck, terms } = reviewGroups(result.records);
  const selection = importSelection(result.records, decisions);
  const credits = creditLine(selection);
  const count = result.records.length;
  const ids = useId();

  return (
    <>
      <h1 className={styles.h2} ref={headingRef} tabIndex={-1}>
        {count} {count === 1 ? "course" : "courses"} found
      </h1>
      {credits ? (
        <p className={styles.summary} aria-live="polite">
          {credits}
        </p>
      ) : null}
      <div className={styles.review}>
        {/* Focusable, so the list scrolls from the keyboard even when no row has a control. */}
        <div className={styles.reviewScroll} role="region" aria-label="Courses found" tabIndex={0}>
          {toCheck.length ? (
            <section aria-labelledby={`${ids}-check`}>
              <h2 id={`${ids}-check`} className={styles.group} data-tone="check">
                To check
              </h2>
              <ul>
                {toCheck.map((record) => (
                  <li key={record.id} className={styles.checkRow} data-flagged="">
                    <span className="ui-code">{record.code}</span>
                    <div className={styles.checkBody}>
                      <span className={styles.rowTitle}>{record.title}</span>
                      <span className={styles.reason}>{checkReason(record)}</span>
                      <Segmented
                        label={`How to count ${record.code}`}
                        size="sm"
                        options={CHECK_OPTIONS}
                        value={decisions[record.id] ?? null}
                        onValueChange={(value) => onDecide(record.id, value)}
                        className={styles.decide}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {terms.map((group, i) => (
            <section key={group.term} aria-labelledby={`${ids}-t${i}`}>
              <h2 id={`${ids}-t${i}`} className={styles.group}>
                {termLabel(group.term)}
              </h2>
              <ul>
                {group.records.map((record) => (
                  <li key={record.id} className={styles.row}>
                    <span className="ui-code">{record.code}</span>
                    <span className={styles.rowTitle}>{record.title}</span>
                    <span className={styles.rowFact}>{rowFact(record)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <p className={styles.hint}>Labeled fields like your name and student ID are removed before matching.</p>
      {conflictNotice}
      <div className={styles.actions}>
        <Button size="lg" disabled={!canSave || selection.length === 0} onClick={onSave}>
          Looks right
        </Button>
        <Button variant="quiet" onClick={onChooseAnother}>
          Use a different file
        </Button>
      </div>
    </>
  );
}
