import type { TranscriptCourseRecord } from "../types";

export function missingApprovedRecords(
  approved: readonly TranscriptCourseRecord[],
  current: readonly TranscriptCourseRecord[],
): TranscriptCourseRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  return approved.filter((record) => {
    const adopted = byId.get(record.id);
    return !adopted || adopted.appliedStatus !== record.appliedStatus;
  });
}
