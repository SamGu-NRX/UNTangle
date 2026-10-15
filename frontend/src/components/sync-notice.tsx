"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { usePlanner, type SyncConflict } from "@/components/planner-provider";
import { getMajorById } from "@/lib/planner";
import { academicQuestions, answerAcademicQuestions, scheduleDifference } from "@/lib/sync/planner-sync";
import type { AcademicQuestion, CourseFacts } from "@untangle/sync";
import "./sync-notice.css";

const SYNC_NOTICE_ID = "sync-notice";
const OPEN_EVENT = "untangle:open-sync-notice";

/** Opens the current conflict's choice: the questions dialog, or focus on the notice's buttons. */
export function openSyncNotice(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
const FAILED = "Couldn't apply your choice. Check your connection and try again.";

const subject = {
  schedule: { name: "Main", deleted: "Main was" },
  "academic-record": { name: "Your courses", deleted: "Your courses were" },
  preferences: { name: "Your preferences", deleted: "Your preferences were" },
} as const;

function courseFact(facts: CourseFacts): string {
  if (facts.manualCredit) return "Done (your credit mark)";
  if (facts.status === "completed") return "Done";
  if (facts.status === "inProgress") return "Taking now";
  return "Not taken";
}

/** The two sides of one question as the student reads them, and whether to say which device each came from. */
function sides(question: AcademicQuestion): { name: string; latest: string; mine: string; where: boolean } {
  switch (question.kind) {
    case "course": {
      const latest = courseFact(question.latest), mine = courseFact(question.local);
      // Same status, different transcript details: the device is the whole difference.
      return latest === mine
        ? { name: question.course, latest: "Transcript from the other device", mine: "Transcript from this device", where: false }
        : { name: question.course, latest, mine, where: true };
    }
    case "major":
      return { name: "Major", latest: getMajorById(question.latest)?.name ?? "No major", mine: getMajorById(question.local)?.name ?? "No major", where: true };
    case "catalogId":
      return { name: "Catalog year", latest: question.latest ?? "Not set", mine: question.local ?? "Not set", where: true };
    case "transcript-id":
      // A transcript row moved to another course on one side; the row itself names no course to show.
      return { name: "A transcript entry", latest: "Keep the other device's", mine: "Keep this device's", where: false };
  }
}

/** What a question is about, so its answer stays with it. */
function questionKey(question: AcademicQuestion): string {
  return question.kind === "course" ? `course:${question.course}` : question.kind === "transcript-id" ? `row:${question.id}` : question.kind;
}

/** One question as a pair of radios; the other device's value is chosen until the student picks. */
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
            {text.where ? <span className="sync-question__where">{side === "latest" ? "Other device" : "This device"}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function AcademicReview({ conflict, open, onOpenChange, onSettled }: { conflict: SyncConflict; open: boolean; onOpenChange: (open: boolean) => void; onSettled: () => void }) {
  const { settleSyncConflict } = usePlanner();
  // Questions are recomputed from the student's side on every status read, so one can appear, or move,
  // while the dialog is open. Answers are kept by question, not by position.
  const questions = academicQuestions(conflict);
  const [answers, setAnswers] = useState<Record<string, "latest" | "mine">>({});
  const answerOf = (question: AcademicQuestion) => answers[questionKey(question)] ?? "latest";
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
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const settled = await settleSyncConflict({ kind: "answers", body: answerAcademicQuestions(conflict, questions.map(answerOf)) });
              setSaving(false);
              // On failure the dialog stays open with the student's answers.
              if (!settled) {
                toast({ message: FAILED, tone: "error" });
                return;
              }
              onSettled();
            }}
          >
            Save choices
          </Button>
        </>
      }
    >
      <div className="sync-questions">
        {questions.map((question) => (
          <Question
            key={questionKey(question)}
            question={question}
            value={answerOf(question)}
            onChange={(side) => setAnswers((current) => ({ ...current, [questionKey(question)]: side }))}
          />
        ))}
      </div>
    </Dialog>
  );
}

function copyFor(conflict: SyncConflict): { title: string; detail: string } {
  // "Somewhere else" for this browser's own conflicts: another tab, or another device's change a pull brought in.
  const where = conflict.source === "local" ? "somewhere else" : "on another device";
  if (conflict.latest === null) {
    return { title: `${subject[conflict.kind].deleted} deleted ${where}.`, detail: "Keep yours to save it again, or use the latest and let it go." };
  }
  if (conflict.kind === "schedule") {
    const differ = scheduleDifference(conflict.mine, conflict.latest);
    const what = differ === 0 ? "Your version and the latest one differ." : `${differ} ${differ === 1 ? "course differs" : "courses differ"} from your version.`;
    return { title: `Main changed ${where}.`, detail: `${what} Keep yours as a copy in Schedules on this device, or use the latest.` };
  }
  return { title: `${subject[conflict.kind].name} changed ${where} too.`, detail: "Choose what to keep where both changed." };
}

/**
 * The signed-in student's open sync conflict, on every lens (docs/architecture/README.md,
 * "Conflicts depend on the document kind"). It never blocks the page: the student keeps
 * working on their own version until they choose, and a schedule they don't use is kept
 * in Schedules. The page leaves room for it below its content (--sync-notice-h), so it
 * never hides what keyboard focus lands on.
 */
export function SyncNotice() {
  const { syncConflict, settleSyncConflict, clientOutdated } = usePlanner();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<"use-latest" | "keep-mine" | null>(null);
  const section = useRef<HTMLElement>(null);
  const copy = clientOutdated
    ? { title: "UNTangle was updated.", detail: "Reload to keep editing. Your changes on this device are kept." }
    : syncConflict
      ? copyFor(syncConflict)
      : null;
  const noticeKey = clientOutdated ? "outdated" : syncConflict ? `${syncConflict.documentId}:${syncConflict.source}` : null;

  // The notice's height, for the page's bottom space and the toasts above it.
  useEffect(() => {
    const element = section.current;
    const root = document.documentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => root.style.setProperty("--sync-notice-h", `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--sync-notice-h");
    };
  }, [noticeKey]);

  const asks = syncConflict?.kind === "academic-record" && syncConflict.latest !== null;
  useEffect(() => {
    const open = () => (asks ? setReviewing(true) : section.current?.focus());
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, [asks]);

  /** After a choice the notice goes away; focus moves to the page rather than being dropped. */
  const settled = () => {
    setReviewing(false);
    if (section.current?.contains(document.activeElement) || document.activeElement === document.body) {
      document.getElementById("main")?.focus();
    }
  };
  const choose = async (kind: "use-latest" | "keep-mine") => {
    setBusy(kind);
    const done = await settleSyncConflict({ kind });
    setBusy(null);
    if (done) settled();
    else toast({ message: FAILED, tone: "error" });
  };

  return (
    <>
      {/* Always present, so a screen reader announces the title when it arrives. */}
      <p className="sr-only-v2" role="status">
        {copy?.title ?? ""}
      </p>
      {copy ? (
        <section
          ref={section}
          id={SYNC_NOTICE_ID}
          tabIndex={-1}
          className="sync-notice"
          aria-labelledby="sync-notice-title"
          data-ui=""
          key={noticeKey}
        >
          <p className="sync-notice__title" id="sync-notice-title">
            {copy.title}
          </p>
          <p className="sync-notice__detail">{copy.detail}</p>
          <div className="sync-notice__actions">
            {clientOutdated ? (
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            ) : asks ? (
              <Button size="sm" onClick={() => setReviewing(true)}>
                Choose what to keep
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" loading={busy === "use-latest"} disabled={busy !== null} onClick={() => choose("use-latest")}>
                  Use the latest
                </Button>
                <Button size="sm" loading={busy === "keep-mine"} disabled={busy !== null} onClick={() => choose("keep-mine")}>
                  {syncConflict?.latest === null ? "Keep mine" : "Keep mine as a copy"}
                </Button>
              </>
            )}
          </div>
          {asks && syncConflict ? <AcademicReview conflict={syncConflict} open={reviewing} onOpenChange={setReviewing} onSettled={settled} /> : null}
        </section>
      ) : null}
    </>
  );
}
