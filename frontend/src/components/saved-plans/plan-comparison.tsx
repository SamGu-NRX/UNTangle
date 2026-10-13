import { describeCourseFactChanges, describeLockChanges, type PlanDiff } from "@/lib/plan-library/diff";
import { statusLabel } from "@/components/saved-plans/plans-view-model";

// The comparison a plan card opens: one row per field that differs between
// the saved plan and the working schedule. Kept apart from plans-client so a
// new kind of row is added here without touching the card or the library.

function DiffRow({ children }: { children: React.ReactNode }) {
  return <li className="plans-diff__row">{children}</li>;
}

/** A course code in a diff row, set like everywhere else: Syne 13. */
function Code({ children }: { children: React.ReactNode }) {
  return <strong className="ui-code">{children}</strong>;
}

/**
 * A shared sentence from diff.ts that opens with the course code, with the
 * code set as a Code. The wording stays single-sourced with the restore
 * preview, which quotes the same strings.
 */
function CodeLead({ code, line }: { code: string; line: string }) {
  if (!line.startsWith(code)) return <>{line}</>;
  return (
    <>
      <Code>{code}</Code>
      {line.slice(code.length)}
    </>
  );
}

export function PlanComparison({ id, diff }: { id: string; diff: PlanDiff }) {
  return (
    <div id={id} className="plans-diff">
      <p className="plans-diff__summary">
        {diff.preservedFieldCount} of {diff.comparedFieldCount} fields match the working schedule.
        {diff.changedFieldCount > 0 ? ` ${diff.changedFieldCount} differ.` : ""}
      </p>
      {diff.changedFieldCount === 0 && diff.unknownReferences.length === 0 ? (
        <p className="plans-muted">Everything this plan declares matches the working schedule.</p>
      ) : (
        <ul className="plans-diff__rows">
          {diff.statusChanges.map((change) => (
            <DiffRow key={`status-${change.courseCode}`}>
              <Code>{change.courseCode}</Code> is {statusLabel(change.from)} in the plan but {statusLabel(change.to)} in the
              working schedule
            </DiffRow>
          ))}
          {diff.sectionChanges.map((change) => (
            <DiffRow key={`section-${change.courseCode}-${change.kind}`}>
              <Code>{change.courseCode}</Code>{" "}
              {change.kind === "added"
                ? `has a working-schedule section not in the plan (${change.to ? change.to.sectionId : ""})`
                : change.kind === "removed"
                  ? `is selected in the plan (${change.from?.sectionId}) but not in the working schedule`
                  : `selects ${change.from?.sectionId} in the plan but ${change.to?.sectionId} in the working schedule`}
            </DiffRow>
          ))}
          {diff.unknownReferences.map((ref) => (
            <DiffRow key={`unknown-${ref.courseCode}-${ref.sectionId}`}>
              <Code>{ref.courseCode}</Code> references {ref.sectionId}, which no longer resolves (
              {ref.side === "savedPlan" ? "saved plan" : "working schedule"})
            </DiffRow>
          ))}
          {describeLockChanges(diff.lockChanges).map((line, i) => (
            <DiffRow key={`lock-${line}`}>
              <CodeLead code={diff.lockChanges[i].courseCode} line={line} />
            </DiffRow>
          ))}
          {describeCourseFactChanges(diff.courseFactChanges).map((line, i) => (
            <DiffRow key={`fact-${line}`}>
              <CodeLead code={diff.courseFactChanges[i].courseCode} line={line} />
            </DiffRow>
          ))}
          {diff.optimizationChanged ? <DiffRow>The optimization preference differs</DiffRow> : null}
          {diff.activeDayChanged ? <DiffRow>The preferred day differs</DiffRow> : null}
          {diff.majorChanged ? <DiffRow>The selected major differs</DiffRow> : null}
          {diff.transcriptRecords.changed ? (
            <DiffRow>
              Transcript records differ ({diff.transcriptRecords.savedPlan} in the plan,{" "}
              {diff.transcriptRecords.workingState} in the working schedule)
            </DiffRow>
          ) : null}
        </ul>
      )}
    </div>
  );
}
