"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { usePlanner } from "@/components/planner-provider";
import { Question, questionKey, type QuestionSides } from "@/components/sync-notice";
import { KEEP_ACCOUNT, type GuestSignIn } from "@/lib/guest-sign-in";
import "./sync-notice.css";

const SIDES: QuestionSides = { latest: "Your account", mine: "This browser", latestOf: "your account", mineOf: "this browser" };

/** Preferences as one choice: they are compared as a whole, and a mix of groups from two people's settings means nothing. */
function PreferencesQuestion({ value, onChange }: { value: "account" | "guest"; onChange: (value: "account" | "guest") => void }) {
  const name = useId();
  const options = [
    { side: "account", label: "Your account's preferences" },
    { side: "guest", label: "This browser's preferences" },
  ] as const;
  return (
    <fieldset className="sync-question">
      <legend>Preferences</legend>
      {options.map(({ side, label }) => (
        <label key={side} className="sync-question__option">
          <input type="radio" name={name} checked={value === side} onChange={() => onChange(side)} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Sheet({ signIn }: { signIn: GuestSignIn }) {
  const { settleGuestSignIn } = usePlanner();
  const [answers, setAnswers] = useState<Record<string, "latest" | "mine">>({});
  const [preferences, setPreferences] = useState<"account" | "guest">("account");
  const choose = (schedule: "guest" | "account") =>
    settleGuestSignIn({ schedule, answers: signIn.questions.map((question) => answers[questionKey(question)] ?? "latest"), preferences });
  const asksSchedule = signIn.schedule === "ask";
  const differ = signIn.scheduleDifference;
  return (
    <Dialog
      open
      // Escape and the scrim keep everything the account has; this browser's work is kept in Schedules.
      onOpenChange={(open) => (open ? undefined : settleGuestSignIn(KEEP_ACCOUNT(signIn)))}
      title={asksSchedule ? "You made a schedule before signing in." : "You made changes before signing in."}
      description={
        asksSchedule
          ? differ === 0
            ? "It's different from your saved schedule."
            : `${differ} ${differ === 1 ? "course differs" : "courses differ"} from your saved schedule.`
          : "Your account has different values for these. Choose which to keep."
      }
      width={520}
      footer={
        asksSchedule ? (
          <>
            <Button variant="ghost" onClick={() => choose("account")}>
              Keep my saved schedule
            </Button>
            <Button onClick={() => choose("guest")}>Use this one</Button>
          </>
        ) : (
          <Button onClick={() => choose("account")}>Save choices</Button>
        )
      }
    >
      {signIn.questions.length > 0 || signIn.preferences === "ask" ? (
        <div className="sync-questions">
          {asksSchedule ? <p className="guest-sign-in__lead">Your account and this browser also differ here:</p> : null}
          {signIn.questions.map((question) => (
            <Question
              key={questionKey(question)}
              question={question}
              where={SIDES}
              value={answers[questionKey(question)] ?? "latest"}
              onChange={(side) => setAnswers((current) => ({ ...current, [questionKey(question)]: side }))}
            />
          ))}
          {signIn.preferences === "ask" ? <PreferencesQuestion value={preferences} onChange={setPreferences} /> : null}
        </div>
      ) : null}
      <p className="guest-sign-in__foot">Whatever you don&apos;t choose from this browser is kept in Schedules.</p>
    </Dialog>
  );
}

/**
 * The one question signing in asks when this browser's guest work and the
 * account both have different work (docs/architecture/guest-sync.md). The
 * account's values are chosen until the student picks otherwise.
 */
export function GuestSignInSheet() {
  const { guestSignIn } = usePlanner();
  return guestSignIn ? <Sheet signIn={guestSignIn} /> : null;
}
