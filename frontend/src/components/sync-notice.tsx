"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { usePlanner, type SyncConflict } from "@/components/planner-provider";
import { getMajorById } from "@/lib/planner";
import { academicQuestions, answerAcademicQuestions, scheduleDifference } from "@/lib/sync/planner-sync";
import type { AcademicQuestion, CourseFacts } from "@untangle/sync";
import "./sync-notice.css";

const subject = { schedule: "Main", "academic-record": "Your courses", preferences: "Your preferences" } as const;

function courseFact(facts: CourseFacts): string {
  if (facts.manualCredit) return "Done (your credit mark)";
  if (facts.status === "completed") return "Done";
  if (facts.status === "inProgress") return "Taking now";
  return "Not taken";
}

/** The two sides of one question, other device's first, as the student reads them. */
function sides(question: AcademicQuestion): { name: string; latest: string; mine: string } {
  switch (question.kind) {
    case "course": {
      const latest = courseFact(question.latest), mine = courseFact(question.local);
      // Same status, different transcript rows: say so rather than show two equal choices.
      return latest === mine
        ? { name: question.course, latest: `${latest}, other device's transcript rows`, mine: `${mine}, this device's transcript rows` }
        : { name: question.course, latest, mine };
    }
    case "major":
      return { name: "Major", latest: getMajorById(question.latest)?.name ?? "No major", mine: getMajorById(question.local)?.name ?? "No major" };
    case "catalogId":
      return { name: "Catalog year", latest: question.latest ?? "Not set", mine: question.local ?? "Not set" };
    case "transcript-id":
      return { name: "A transcript row", latest: "The other device's", mine: "This device's" };
  }
}

/** One question, as a pair of radios; the other device's value is chosen until the student picks. */
function Question({ question, value, onChange }: { question: AcademicQuestion; value: "latest" | "mine"; onChange: (value: "latest" | "mine") => void }) {
  const name = useId();
  const text = sides(question);
  return (
    <fieldset className="sync-question">
      <legend>{text.name}</legend>
      {(["latest", "mine"] as const).map((side) => (
        <label key={side} className="sync-question__option">
          <input type="radio" name={name} checked={value === side} onChange={() => onChange(side)} />
          <span>
            {text[side]}
            <span className="sync-question__where">{side === "latest" ? "Other device" : "This device"}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function AcademicReview({ conflict, open, onOpenChange }: { conflict: SyncConflict; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settleSyncConflict } = usePlanner();
  const questions = academicQuestions(conflict);
  const [answers, setAnswers] = useState<Array<"latest" | "mine">>(() => questions.map(() => "latest"));
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose what to keep"
      description="These changed on this device and on another one. Everything else is already combined."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await settleSyncConflict({ kind: "answers", body: answerAcademicQuestions(conflict, answers) });
                onOpenChange(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save choices
          </Button>
        </>
      }
    >
      <div className="sync-questions">
        {questions.map((question, index) => (
          <Question
            key={question.kind === "course" ? question.course : question.kind === "transcript-id" ? question.id : question.kind}
            question={question}
            value={answers[index] ?? "latest"}
            onChange={(side) => setAnswers((current) => current.map((answer, i) => (i === index ? side : answer)))}
          />
        ))}
      </div>
    </Dialog>
  );
}

function copyFor(conflict: SyncConflict): { title: string; detail: string } {
  const where = conflict.source === "local" ? "in another tab" : "on another device";
  if (conflict.latest === null) {
    return { title: `${subject[conflict.kind]} was deleted ${where}.`, detail: "Keep yours to save it again, or use the latest and let it go." };
  }
  if (conflict.kind === "schedule") {
    const differ = scheduleDifference(conflict.mine, conflict.latest);
    return {
      title: `Main changed ${where}.`,
      detail:
        differ === 0
          ? "Your version and the latest one differ. Keep yours as a copy in Schedules, or use the latest."
          : `${differ} ${differ === 1 ? "course differs" : "courses differ"} from your version. Keep yours as a copy in Schedules, or use the latest.`,
    };
  }
  return { title: `Your courses changed ${where} too.`, detail: "Choose what to keep where both changed." };
}

/**
 * The signed-in student's open sync conflict, on every lens (docs/architecture/README.md,
 * "Conflicts depend on the document kind"). It never blocks the page: the student keeps
 * working on their own version until they choose. Nothing is dropped either way; a schedule
 * not used is kept in Schedules.
 */
export function SyncNotice() {
  const { syncConflict, settleSyncConflict, clientOutdated } = usePlanner();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<"use-latest" | "keep-mine" | null>(null);

  if (clientOutdated) {
    return (
      <section className="sync-notice" aria-labelledby="sync-notice-title" data-ui="">
        <p className="sync-notice__title" id="sync-notice-title" role="status">
          UNTangle was updated.
        </p>
        <p className="sync-notice__detail">Reload to keep editing. Your changes on this device are kept.</p>
        <div className="sync-notice__actions">
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </section>
    );
  }
  if (!syncConflict) return null;

  const { title, detail } = copyFor(syncConflict);
  const asks = syncConflict.kind === "academic-record" && syncConflict.latest !== null;
  const choose = async (kind: "use-latest" | "keep-mine") => {
    setBusy(kind);
    try {
      await settleSyncConflict({ kind });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sync-notice" aria-labelledby="sync-notice-title" data-ui="" key={`${syncConflict.documentId}:${syncConflict.source}`}>
      <p className="sync-notice__title" id="sync-notice-title" role="status">
        {title}
      </p>
      <p className="sync-notice__detail">{detail}</p>
      <div className="sync-notice__actions">
        {asks ? (
          <Button size="sm" onClick={() => setReviewing(true)}>
            Choose what to keep
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" loading={busy === "use-latest"} disabled={busy !== null} onClick={() => choose("use-latest")}>
              Use the latest
            </Button>
            <Button size="sm" loading={busy === "keep-mine"} disabled={busy !== null} onClick={() => choose("keep-mine")}>
              {syncConflict.latest === null ? "Keep mine" : "Keep mine as a copy"}
            </Button>
          </>
        )}
      </div>
      {asks ? <AcademicReview conflict={syncConflict} open={reviewing} onOpenChange={setReviewing} /> : null}
    </section>
  );
}
