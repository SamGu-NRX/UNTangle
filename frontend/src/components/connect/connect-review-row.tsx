import type {
  TranscriptAppliedStatus,
  TranscriptCourseRecord,
} from "@/lib/types";
import styles from "./connect.module.css";

type Props = {
  record: TranscriptCourseRecord;
  status: TranscriptAppliedStatus;
  included: boolean;
  onInclude: (included: boolean) => void;
  onStatus: (status: TranscriptAppliedStatus) => void;
};

export function ConnectReviewRow({
  record,
  status,
  included,
  onInclude,
  onStatus,
}: Props) {
  const eligible = status === "completed" || status === "inProgress";
  return (
    <li>
      <label className={styles.row}>
        <input
          type="checkbox"
          aria-label={`Include ${record.code}`}
          checked={included}
          disabled={!eligible}
          onChange={(event) => onInclude(event.target.checked)}
        />
        <span>
          <strong>{record.code}</strong>
          <span>{record.title}</span>
          <small>
            {record.term} · Grade {record.grade || "unknown"} ·{" "}
            {record.credits ?? "?"} credits
          </small>
        </span>
      </label>
      <details className={styles.exception}>
        <summary>
          {record.reviewRequired
            ? "Review this course"
            : "Change detected status"}
        </summary>
        <label className={styles.decision}>
          Apply as
          <select
            aria-label={`Status for ${record.code}`}
            value={status}
            onChange={(event) => {
              const next = event.target.value;
              if (
                next === "completed" ||
                next === "inProgress" ||
                next === "needsReview" ||
                next === "ignored"
              )
                onStatus(next);
            }}
          >
            <option value="completed">Completed</option>
            <option value="inProgress">In progress</option>
            <option value="needsReview">Needs review</option>
            <option value="ignored">Ignore</option>
          </select>
        </label>
      </details>
      {record.reviewRequired && (
        <p className={styles.note}>{record.rationale}</p>
      )}
    </li>
  );
}
