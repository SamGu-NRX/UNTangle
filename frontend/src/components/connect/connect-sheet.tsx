"use client";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { authClient } from "@/lib/auth-client";
import { ConnectReviewRow } from "./connect-review-row";
import { ConnectPersistence } from "./connect-persistence";
import { usePlanner } from "@/components/planner-provider";
import { parseConnectTranscript } from "@/lib/connect/import";
import { missingApprovedRecords } from "@/lib/connect/import-confirmation";
import { selectApprovedTranscriptRecords, type TranscriptReconcileResult } from "@/lib/transcript-import";
import type { TranscriptAppliedStatus, TranscriptCourseRecord } from "@/lib/types";
import { Spinner } from "@/components/ui/icons";
import { HiddenPdfInput, StepDots } from "./connect-parts";
import { useMyUntTrip } from "./myunt-trip";
import { clearTripFlag, setTripFlag } from "./trip-flag";
import { filePicker, pickPdf, type PickerHost } from "./pick-pdf";
import type { Incoming } from "./pdf-drop";
import styles from "./connect.module.css";

type State =
  | { phase: "start" }
  | { phase: "parsing" }
  | { phase: "error"; message: string }
  | { phase: "review"; result: TranscriptReconcileResult }
  | { phase: "saved"; records: TranscriptCourseRecord[] };

const MYUNT_LINK = "https://my.unt.edu/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN.GBL";

type SheetProps = {
  /** Focused when a phase begins, and by the host when the sheet opens. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  /** Reopen as back from myUNT (the page reloaded during the trip). */
  restoreTrip: boolean;
  /** A PDF (or a refusal) dropped anywhere on the page, for this sheet to take. */
  incoming: Incoming | null;
  onIncomingTaken: (id: number) => void;
};

export function ConnectSheet(props: SheetProps) {
  const session = authClient.useSession();
  // Remounting cancels the old identity's work and drops its review rows and approvals together.
  const identity = session.data?.user.id ? `user:${session.data.user.id}` : "guest";
  return <IdentityConnectSheet key={identity} identityReady={!session.isPending} {...props} />;
}

function IdentityConnectSheet({
  identityReady,
  headingRef,
  onClose,
  restoreTrip,
  incoming,
  onIncomingTaken,
}: SheetProps & { identityReady: boolean }) {
  const { applyTranscriptRecords, hydrated, plannerState, conflict } = usePlanner();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "start" });
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, TranscriptAppliedStatus>>({});
  const { trip, openFromLink, reset: resetTrip } = useMyUntTrip(() => (restoreTrip ? { stage: "back" } : { stage: "idle" }), setTripFlag);
  const active = useRef<AbortController | null>(null);
  const run = useRef(0);
  const heading = headingRef;
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      run.current++;
    },
    [],
  );
  // Opening focus is the host's (Dialog/BottomSheet initialFocus), so the
  // modal layer records the opener first and can return focus to it on
  // close. From then on each phase change moves focus to the new heading.
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    heading.current?.focus();
  }, [state.phase, heading]);
  // Coming back from myUNT puts focus on "Use the downloaded PDF", without
  // pressing it: the file picker needs the student's own click.
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    if (trip.stage === "back") pdfButton.current?.focus();
  }, [trip.stage]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    return ++run.current;
  }
  async function parse(file: File, id: number, signal: AbortSignal) {
    setState({ phase: "parsing" });
    const result = await parseConnectTranscript(file, signal);
    if (run.current !== id) return;
    setIncluded(new Set());
    setOverrides({});
    setState({ phase: "review", result });
  }
  async function upload(file: File | undefined) {
    if (!file || !identityReady) return;
    // The file is here: the trip to myUNT is over.
    clearTripFlag();
    const id = cancel();
    const controller = new AbortController();
    active.current = controller;
    try {
      await parse(file, id, controller.signal);
    } catch (error) {
      if (run.current === id)
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "This PDF couldn't be read. Try another file.",
        });
    }
  }
  const selected =
    state.phase === "review" ? selectApprovedTranscriptRecords(state.result.records, included, overrides) : [];
  function save() {
    if (!selected.length || !identityReady || !hydrated) return;
    applyTranscriptRecords(selected);
    setState({ phase: "saved", records: selected });
  }
  const missingRecords =
    state.phase === "saved" ? missingApprovedRecords(state.records, plannerState.transcriptRecords) : [];
  function reapply() {
    if (!missingRecords.length || !identityReady || !hydrated || conflict) return;
    applyTranscriptRecords(missingRecords);
    heading.current?.focus();
  }
  function startOver() {
    cancel();
    setState({ phase: "start" });
  }

  /**
   * Opens the picker in Downloads where the browser has one; elsewhere the
   * hidden file input, clicked in this same gesture. A cancelled picker
   * changes nothing.
   */
  function choosePdf() {
    // TypeScript's DOM types lack the File System Access API; pick-pdf.ts types the one call.
    const show = filePicker(window as unknown as PickerHost);
    if (!show) {
      fileInput.current?.click();
      return;
    }
    void pickPdf(show).then((picked) => {
      if (picked.kind === "file") void upload(picked.file);
      else if (picked.kind === "fallback") fileInput.current?.click();
    });
  }

  const takeIncoming = useEffectEvent((item: Incoming) => {
    onIncomingTaken(item.id);
    if (item.kind === "file") {
      void upload(item.file);
      return;
    }
    cancel();
    setState({ phase: "error", message: item.message });
  });
  useEffect(() => {
    if (incoming && identityReady) takeIncoming(incoming);
  }, [incoming, identityReady]);

  const title =
    state.phase === "review"
      ? "Review your courses"
      : state.phase === "saved"
        ? missingRecords.length
          ? "Review your import"
          : "Your courses are ready"
        : state.phase === "parsing"
          ? "Reading your transcript"
          : state.phase === "error"
            ? "That file didn't import"
            : "Import from myUNT";
  const dots = state.phase === "review" ? 2 : state.phase === "saved" ? 3 : state.phase === "start" ? 0 : 1;
  const openMyUnt = (label: string, primary: boolean) => (
    <a
      className={`ui-btn ${primary ? "ui-btn--primary" : "ui-btn--ghost"}`}
      href={MYUNT_LINK}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openFromLink}
      data-ui=""
    >
      {label} <span aria-hidden="true" className={styles.trail}>↗</span>
      <span className="sr-only-v2"> (opens a new window)</span>
    </a>
  );
  const downloadedPdfButton = (primary: boolean) => (
    <button
      ref={pdfButton}
      type="button"
      className={`ui-btn ${primary ? "ui-btn--primary" : "ui-btn--ghost"}`}
      disabled={!identityReady}
      onClick={choosePdf}
      data-ui=""
    >
      Use the downloaded PDF
    </button>
  );
  const acceptsFile = state.phase === "start" || state.phase === "error";

  return (
    <section className={styles.sheet} aria-labelledby="connect-title" data-phase={state.phase}>
      <StepDots current={dots} />
      {state.phase === "saved" && !missingRecords.length ? (
        <span className={styles.seal} data-tone="ok" aria-hidden="true">
          ✓
        </span>
      ) : state.phase === "error" ? (
        <span className={styles.seal} data-tone="error" aria-hidden="true">
          !
        </span>
      ) : null}
      <h2 id="connect-title" ref={heading} tabIndex={-1} className={styles.title}>
        {title}
      </h2>
      {acceptsFile ? <HiddenPdfInput ref={fileInput} onFile={(file) => void upload(file)} /> : null}

      {state.phase === "start" && trip.stage === "idle" && (
        <>
          <p className={styles.lead}>
            Open your unofficial transcript in myUNT and download it as a PDF. Then choose it here, or drop it anywhere
            on this page.
          </p>
          <ul className={styles.access}>
            <li>
              <AccessGlyph kind="reads" />
              <span>
                <strong>Reads</strong> course codes, terms and grades from the PDF
              </span>
            </li>
            <li>
              <AccessGlyph kind="removes" />
              <span>
                <strong>Removes</strong> labeled identity fields before matching
              </span>
            </li>
            <li>
              <AccessGlyph kind="keeps" />
              <span>
                <strong>Keeps</strong> the course list you approve in your plan
              </span>
            </li>
          </ul>
          <p className={styles.quiet}>The PDF is read in this browser. It isn&apos;t uploaded.</p>
          <div className={styles.foot}>
            {openMyUnt("Open myUNT", true)}
            <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose} data-ui="">
              Not now
            </button>
          </div>
          <button type="button" className={styles.linkButton} disabled={!identityReady} onClick={choosePdf}>
            Already downloaded it? Choose the PDF
          </button>
        </>
      )}

      {state.phase === "start" && trip.stage === "away" && (
        <>
          <p className={styles.lead} role="status">
            Download your transcript as a PDF, then come back.
          </p>
          <p className={styles.quiet}>In myUNT: Academic Records › Unofficial Transcript › View as PDF.</p>
          <div className={styles.foot}>
            {downloadedPdfButton(false)}
            {openMyUnt("Open myUNT again", false)}
          </div>
        </>
      )}

      {state.phase === "start" && trip.stage === "back" && (
        <>
          <p className={styles.lead} role="status">
            Choose the transcript PDF you just downloaded.
          </p>
          <div className={styles.foot}>
            {downloadedPdfButton(true)}
            {openMyUnt("Open myUNT again", false)}
          </div>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              clearTripFlag();
              resetTrip();
            }}
          >
            Start over
          </button>
        </>
      )}

      {state.phase === "parsing" && (
        <>
          <p role="status" className={styles.lead}>
            Reading courses in your browser…
          </p>
          <ol className={styles.progress}>
            <li data-state="done">
              <ProgressIcon state="done" />
              Get the PDF
            </li>
            <li data-state="active">
              <ProgressIcon state="active" />
              Read it and remove labeled identity fields
            </li>
            <li data-state="pending">
              <ProgressIcon state="pending" />
              Match courses to your plan
            </li>
          </ol>
          <p className={styles.quiet}>This happens in your browser. The PDF is not uploaded.</p>
          <div className={styles.foot}>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={startOver} data-ui="">
              Cancel import
            </button>
          </div>
        </>
      )}

      {state.phase === "error" && (
        <>
          <p className={styles.alert} role="alert">
            {state.message}
          </p>
          <p className={styles.detail}>Your plan is unchanged.</p>
          <div className={styles.foot}>
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              disabled={!identityReady}
              onClick={choosePdf}
              data-ui=""
            >
              Choose another file
            </button>
            {openMyUnt("Open myUNT again", false)}
          </div>
        </>
      )}

      {state.phase === "review" && (
        <>
          <p className={styles.summary}>
            {state.result.records.length} courses found.
            {state.result.records.some((r) => r.reviewRequired)
              ? ` ${state.result.records.filter((r) => r.reviewRequired).length} need your decision.`
              : ""}
          </p>
          <p className={styles.detail}>Check each grade and term, then choose which to add. Nothing is saved until you choose Save.</p>
          <ul className={styles.records}>
            {state.result.records.map((record) => (
              <ConnectReviewRow
                key={record.id}
                record={record}
                status={overrides[record.id] ?? record.appliedStatus}
                included={included.has(record.id)}
                onInclude={(checked) =>
                  setIncluded((current) => {
                    const next = new Set(current);
                    if (checked) next.add(record.id);
                    else next.delete(record.id);
                    return next;
                  })
                }
                onStatus={(status) => {
                  setOverrides((current) => ({
                    ...current,
                    [record.id]: status,
                  }));
                  setIncluded((current) => {
                    const next = new Set(current);
                    next.delete(record.id);
                    return next;
                  });
                }}
              />
            ))}
          </ul>
          <div className={styles.foot}>
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              disabled={!selected.length || !hydrated}
              onClick={save}
              data-ui=""
            >
              Save {selected.length || "selected"} {selected.length === 1 ? "course" : "courses"}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={startOver} data-ui="">
              Start over
            </button>
          </div>
        </>
      )}

      {state.phase === "saved" && (
        <>
          <ConnectPersistence
            records={state.records}
            missingRecords={missingRecords}
            canReapply={identityReady && hydrated && !conflict}
            onReapply={reapply}
          />
          <div className={styles.foot}>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => router.push("/courses")} data-ui="">
              Go to courses
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose} data-ui="">
              Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function AccessGlyph({ kind }: { kind: "reads" | "removes" | "keeps" }) {
  return (
    <svg className={styles.accessGlyph} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "reads" ? (
        <>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </>
      ) : kind === "removes" ? (
        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
      ) : (
        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
      )}
    </svg>
  );
}

function ProgressIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "active") return <Spinner size={16} className={styles.progressSpin} />;
  return <span className={styles.progressIcon} data-state={state} aria-hidden="true" />;
}
