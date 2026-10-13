import { Select } from "@/components/ui/Select";
import { StatusGlyph, type CourseStatusGlyph } from "@/components/ui/StatusGlyph";
import type { TranscriptAppliedStatus, TranscriptCourseRecord } from "@/lib/types";
import styles from "./connect.module.css";

type Props = {
  record: TranscriptCourseRecord;
  status: TranscriptAppliedStatus;
  included: boolean;
  onInclude: (included: boolean) => void;
  onStatus: (status: TranscriptAppliedStatus) => void;
};

const STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "inProgress", label: "In progress" },
  { value: "needsReview", label: "Needs review" },
  { value: "ignored", label: "Ignore" },
];

const GLYPH: Record<TranscriptAppliedStatus, CourseStatusGlyph> = {
  completed: "done",
  inProgress: "taking",
  needsReview: "locked",
  ignored: "available",
};

function isStatus(value: string): value is TranscriptAppliedStatus {
  return value === "completed" || value === "inProgress" || value === "needsReview" || value === "ignored";
}

/**
 * One transcript course: include checkbox, status glyph, code (Syne 13),
 * title, term and grade. A row the import could not settle on its own is
 * tinted and shows its status Select inline, with the reason; other rows
 * keep the Select behind "Change detected status".
 */
export function ConnectReviewRow({ record, status, included, onInclude, onStatus }: Props) {
  const eligible = status === "completed" || status === "inProgress";
  const statusSelect = (
    <div className={styles.decision}>
      <span aria-hidden="true">Apply as</span>
      <Select
        label={`Status for ${record.code}`}
        hideLabel
        size="sm"
        options={STATUS_OPTIONS}
      value={status}
        onValueChange={(next) => {
          if (isStatus(next)) onStatus(next);
        }}
      />
    </div>
  );
  return (
    <li className={styles.reviewRow} data-flagged={record.reviewRequired || undefined}>
      <label className={styles.reviewMain}>
        <input
          type="checkbox"
          className="ui-check__box"
          aria-label={`Include ${record.code}`}
          checked={included}
          disabled={!eligible}
          onChange={(event) => onInclude(event.target.checked)}
        />
        <StatusGlyph status={GLYPH[status]} />
        <span className={styles.reviewText}>
          <span className={styles.reviewLine}>
            <strong className="ui-code">{record.code}</strong>
            <span className={styles.reviewTitle}>{record.title}</span>
          </span>
          <small>
            {record.term} · Grade {record.grade || "unknown"} · {record.credits ?? "?"} credits
          </small>
        </span>
      </label>
      {record.reviewRequired ? (
        <div className={styles.reviewDecision}>
          <p className={styles.note}>{record.rationale}</p>
          {statusSelect}
        </div>
      ) : (
        <details className={styles.exception}>
          <summary>Change detected status</summary>
          {statusSelect}
        </details>
      )}
    </li>
  );
}
