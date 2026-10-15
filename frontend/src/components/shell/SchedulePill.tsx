"use client";

import Link from "next/link";
import { useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, IconButton } from "@/components/ui/Button";
import { Check, ChevronDown, ChevronRight, Close } from "@/components/ui/icons";
import { PLANNING_TERM } from "@/lib/terms";
import { openSyncNotice } from "@/components/sync-notice";
import { SCHEDULE_NAME, chipStatusLabel, chipTone, type ChipTone } from "./plan-status";
import { SCHEDULES_HREF } from "./routes";

function useScheduleState() {
  const { saveState, isRegistered, hydrated, retrySave } = usePlanner();
  // Retry helps only when a request can go through again: a network failure or an ended session, or a
  // guest's browser storage. A conflict is settled by a choice; a refused write, a failed local save or
  // an updated app need a reload.
  const canRetry = isRegistered ? saveState.reason === "network" || saveState.reason === "session" : saveState.reason !== "conflict";
  // A signed-in conflict's choices are in the notice: the status itself opens them.
  const toNotice = saveState.reason === "conflict" && isRegistered ? openSyncNotice : null;
  const tone: ChipTone = hydrated ? chipTone(saveState.status) : "saving";
  const status =
    tone === "saved"
      ? // Signed in, the label is the sync state ("Synced", "Saved on this device").
        isRegistered ? saveState.label : "Saved on this device"
      : hydrated
        ? chipStatusLabel(saveState.status, saveState.label)
        : "Loading";
  return { tone, status, detail: saveState.detail, isRegistered, retrySave, canRetry, toNotice };
}

/**
 * The schedule name, with the term before it when there is room for both.
 * The name is the pill's one fact, so it never gives way to the term: on
 * phones the term is left to the screen's own header and the sheet's
 * title, and a long name ends in an ellipsis. The accessible name starts
 * with the visible words (WCAG 2.5.3), then adds whichever words were left
 * out, the save state and, when given, where the pill goes.
 */
export function PillText({ showTerm, status, action }: { showTerm: boolean; status: string; action?: string }) {
  return (
    <>
      <span className="shell-pill__dot" aria-hidden="true" />
      {showTerm ? (
        <>
          <span className="shell-pill__term">{PLANNING_TERM.name}</span>{" "}
        </>
      ) : null}
      <span className="shell-pill__name">{SCHEDULE_NAME}</span>
      <ChevronDown size={14} className="shell-pill__chevron" />
      <span className="sr-only-v2">
        {showTerm ? " schedule" : ` schedule for ${PLANNING_TERM.name}`}. {status}.{action ? ` ${action}` : ""}
      </span>
    </>
  );
}

/**
 * The schedule pill on desktop (DESIGN.md §8.1): which schedule every lens
 * shows, and the way into the schedules library. A save error adds Retry
 * beside it, because the library is the wrong place to fix that.
 */
export function SchedulePill() {
  const { tone, status, retrySave, canRetry, toNotice } = useScheduleState();
  return (
    <span className="shell-pill-group">
      <Link
        href={SCHEDULES_HREF}
        className="shell-pill"
        data-tone={tone}
      >
        <PillText showTerm status={status} action="Open all schedules" />
      </Link>
      {tone === "error" ? (
        toNotice ? (
          // One control for the conflict: its status, which opens the choice.
          <Button size="sm" variant="quiet" className="shell-pill-error" onClick={toNotice}>
            {status}
          </Button>
        ) : (
          <>
            <span className="shell-pill-error">{status}</span>
            {canRetry ? (
              <Button size="sm" variant="quiet" onClick={retrySave}>
                Retry
              </Button>
            ) : null}
          </>
        )
      ) : null}
    </span>
  );
}

/**
 * The schedule pill on phones: opens a sheet of this term's schedules with
 * a link to the library. Picking a schedule never leaves the lens you are on.
 */
export function PhoneSchedulePill() {
  const { tone, status, detail, isRegistered, retrySave, canRetry, toNotice } = useScheduleState();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="shell-pill"
        data-tone={tone}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <PillText showTerm={false} status={status} />
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={`${PLANNING_TERM.name} schedules`}
        detents={["52%", "92%"]}
        closeOnBack
        header={
          <div className="shell-sheet-head">
            <h2 className="shell-sheet-title">{PLANNING_TERM.name} schedules</h2>
            <IconButton label="Close" size="sm" onClick={() => setOpen(false)}>
              <Close />
            </IconButton>
          </div>
        }
      >
        <ul className="shell-schedules" aria-label={`${PLANNING_TERM.name} schedules`}>
          <li className="shell-schedule" aria-current="true">
            <span className="shell-schedule__name">{SCHEDULE_NAME}</span>
            <span className="shell-schedule__status" data-tone={tone}>
              {status}
            </span>
            <Check size={18} className="shell-schedule__check" />
            <span className="sr-only-v2">Active</span>
          </li>
        </ul>
        {tone === "error" ? (
          <div className="shell-sheet-error">
            {detail ? <p>{detail}</p> : null}
            {canRetry ? (
              <Button variant="secondary" onClick={retrySave}>
                Retry saving
              </Button>
            ) : toNotice ? (
              <Button
                variant="secondary"
                onClick={() => {
                  // The sheet covers the notice; close it first, then focus the notice once it's back in view.
                  setOpen(false);
                  setTimeout(toNotice, 200);
                }}
              >
                {status}
              </Button>
            ) : null}
          </div>
        ) : null}
        <Link href={SCHEDULES_HREF} className="ui-btn ui-btn--secondary shell-sheet-link" data-ui="" onClick={() => setOpen(false)}>
          All schedules and compare
          <ChevronRight size={16} />
        </Link>
        {!isRegistered ? (
          <p className="shell-sheet-foot">
            <Link href="/auth" onClick={() => setOpen(false)}>
              Sign in
            </Link>{" "}
            to keep your schedules on every device.
          </p>
        ) : null}
      </BottomSheet>
    </>
  );
}
