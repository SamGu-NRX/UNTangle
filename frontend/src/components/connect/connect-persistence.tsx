import Link from "next/link";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import type { TranscriptCourseRecord } from "@/lib/types";
import styles from "./connect.module.css";

type Props = {
  records: TranscriptCourseRecord[];
  missingRecords: TranscriptCourseRecord[];
  canReapply: boolean;
  onReapply: () => void;
};

export function ConnectPersistence({
  records,
  missingRecords,
  canReapply,
  onReapply,
}: Props) {
  const count = records.length - missingRecords.length;
  return (
    <div>
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
          <button
            type="button"
            className={styles.primary}
            disabled={!canReapply}
            onClick={onReapply}
          >
            Re-apply approved courses
          </button>
        </>
      )}
      <p className={styles.detail}>
        Your original PDF wasn&apos;t stored. Check your courses, then keep
        planning.
      </p>
      <PlannerPersistencePanel />
      <Link className={styles.primary} href="/courses">
        Review my plan →
      </Link>
    </div>
  );
}
