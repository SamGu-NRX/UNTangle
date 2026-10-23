"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { usePlanner } from "@/components/planner-provider";
import { Question, type QuestionSides } from "@/components/sync-notice";
import { hasCopyableWork, preferenceDifferences, type GuestSignIn } from "@/lib/guest-sign-in";
import { questionKey } from "@/lib/sync/planner-sync";
import "./sync-notice.css";

const SIDES: QuestionSides = { latest: "Your account", mine: "This browser", latestOf: "your account", mineOf: "this browser" };

/** "a", "a and b", "a, b and c". */
function inWords(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");
}

/** Preferences as one choice, with what differs in a sentence, since the two sets can't be shown side by side here. */
function PreferencesQuestion({ signIn, value, onChange }: { signIn: GuestSignIn; value: "account" | "guest"; onChange: (value: "account" | "guest") => void }) {
  const name = useId();
  const options = [
    { side: "account", label: "Your account's preferences" },
    { side: "guest", label: "This browser's preferences" },
  ] as const;
  const differ = preferenceDifferences(signIn);
  return (
    <fieldset className="sync-question">
      <legend>Preferences</legend>
      {options.map(({ side, label }) => (
        <label key={side} className="sync-question__option">
          <input type="radio" name={name} checked={value === side} onChange={() => onChange(side)} />
          <span>{label}</span>
        </label>
      ))}
      {/* Only this browser's set gets a copy; picking it replaces the account's set (guest-sync.md). */}
      <p className="guest-sign-in__lead">
        {differ.length ? `They differ in ${inWords(differ)}. ` : ""}This browser&apos;s set is kept in Schedules if you don&apos;t choose it.
      </p>
    </fieldset>
  );
}

function relativeTime(writtenAt: number | null): string {
  if (writtenAt === null) return "at an unknown time";
  const minutes = Math.max(1, Math.round((Date.now() - writtenAt) / 60000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function HandoverSheet({ writtenAt, open }: { writtenAt: number | null; open: boolean }) {
  const { settleGuestHandover } = usePlanner();
  const leave = () => settleGuestHandover("leave");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : leave())}
      title="Bring this browser's guest work into your account?"
      description={`Someone used UNTangle as a guest here ${relativeTime(writtenAt)}. Only bring it in if it's yours.`}
      width={520}
      focusTitle
      footer={
        <>
          <Button variant="secondary" onClick={leave}>Leave it here</Button>
          <Button onClick={() => settleGuestHandover("bring")}>Bring it in</Button>
        </>
      }
    />
  );
}

function Sheet({ signIn, open }: { signIn: GuestSignIn; open: boolean }) {
  const { settleGuestSignIn } = usePlanner();
  const [answers, setAnswers] = useState<Record<string, "latest" | "mine">>({});
  const [preferences, setPreferences] = useState<"account" | "guest">("account");
  const choose = (schedule: "guest" | "account") =>
    settleGuestSignIn({ schedule, answers, preferences });
  const asksSchedule = signIn.schedule === "ask";
  const differ = signIn.scheduleDifference;
  return (
    <Dialog
      open={open}
      // Escape and the scrim choose "Keep my saved schedule", with the answers as they stand (guest-sync.md).
      onOpenChange={(next) => (next ? undefined : choose("account"))}
      title={asksSchedule ? "You made a schedule before signing in" : "You made changes before signing in"}
      description={
        asksSchedule
          ? differ === 0
            ? "It's different from your saved schedule."
            : `${differ} ${differ === 1 ? "course differs" : "courses differ"} from your saved schedule.`
          : "Your account has different values for these. Choose which to keep."
      }
      width={520}
      focusTitle
      footer={
        asksSchedule ? (
          <>
            <Button variant="secondary" onClick={() => choose("account")}>
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
          {asksSchedule ? (
            <p className="guest-sign-in__lead">Your account and this browser also differ here. These answers apply whichever schedule you keep.</p>
          ) : null}
          {signIn.questions.map((question) => (
            <Question
              key={questionKey(question)}
              question={question}
              where={SIDES}
              value={answers[questionKey(question)] ?? "latest"}
              onChange={(side) => setAnswers((current) => ({ ...current, [questionKey(question)]: side }))}
            />
          ))}
          {signIn.preferences === "ask" ? <PreferencesQuestion signIn={signIn} value={preferences} onChange={setPreferences} /> : null}
        </div>
      ) : null}
      {hasCopyableWork(signIn) ? (
        <p className="guest-sign-in__foot">A schedule or courses you don&apos;t choose from this browser are kept in Schedules.</p>
      ) : null}
    </Dialog>
  );
}

/**
 * The one question signing in asks when this browser's guest work and the
 * account both have different work (docs/architecture/guest-sync.md). The
 * account's values are chosen until the student picks otherwise. The last
 * question stays rendered while the dialog plays its exit.
 */
export function GuestSignInSheet() {
  const { guestSignIn, guestHandover } = usePlanner();
  const [shown, setShown] = useState(guestSignIn);
  if (guestSignIn && guestSignIn !== shown) setShown(guestSignIn);
  return (
    <>
      {guestHandover ? <HandoverSheet writtenAt={guestHandover.writtenAt} open /> : null}
      {shown ? <Sheet key={questionsKey(shown)} signIn={shown} open={guestSignIn !== null} /> : null}
    </>
  );
}

/** A new set of questions starts with fresh answers. */
function questionsKey(signIn: GuestSignIn): string {
  return [signIn.schedule, signIn.record, signIn.preferences, ...signIn.questions.map(questionKey)].join("|");
}
