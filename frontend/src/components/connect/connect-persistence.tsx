import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import type { TranscriptCourseRecord } from "@/lib/types";
import styles from "./connect.module.css";

type Props = {
  records: TranscriptCourseRecord[];
  missingRecords: TranscriptCourseRecord[];
  canReapply: boolean;
  onReapply: () => void;
};

/**
 * The done state's body: how many approved courses are in the plan now,
 * the way to re-apply any a newer saved version dropped, and the plan's
 * save state. The sheet's footer carries "Go to courses" and "Close".
 */
export function ConnectPersistence({ records, missingRecords, canReapply, onReapply }: Props) {
  const count = records.length - missingRecords.length;
  return (
    <div className={styles.done}>
      <p className={styles.lead} role="status" aria-label="Transcript import">
        {count === 0
          ? "Your transcript import was discarded from this plan."
          : `${count} ${count === 1 ? "course" : "courses"} added to your plan.`}
      </p>
      {missingRecords.length > 0 && (
        <>
          <p className={styles.detail}>
            {count > 0
              ? `${missingRecords.length} imported ${missingRecords.length === 1 ? "course is" : "courses are"} no longer in this plan. `
              : ""}
            Re-apply the courses you approved to the current plan.
          </p>
          <button type="button" className="ui-btn ui-btn--primary" disabled={!canReapply} onClick={onReapply} data-ui="">
            Re-apply approved courses
          </button>
        </>
      )}
      <p className={styles.detail}>Your original PDF wasn&apos;t stored.</p>
      <PlannerPersistencePanel />
    </div>
  );
}
