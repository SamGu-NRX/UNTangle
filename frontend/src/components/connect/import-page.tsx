"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { usePlanner } from "@/components/planner-provider";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { Button } from "@/components/ui/Button";
import { Check, Spinner } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { PathLine, PathStop } from "@/components/ui/PathLine";
import { toast, useIsClient } from "@/components/ui/Toast";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { authClient } from "@/lib/auth-client";
import { ImportProblem, parseConnectTranscript, type ParseStage } from "@/lib/connect/import";
import { importSelection, type CheckDecision } from "@/lib/connect/review";
import type { TranscriptReconcileResult } from "@/lib/transcript-import";
import { AlertGlyph, FileGlyph, HiddenPdfInput, WindowGlyph } from "./connect-parts";
import { ImportReview } from "./import-review";
import { MYUNT_URL, useMyUntTrip, type Trip } from "./myunt-trip";
import { PdfDropTarget, takeHandedDrop, type DropResult } from "./pdf-drop";
import { filePicker, pickPdf, type PickerHost } from "./pick-pdf";
import { Thesis } from "./thesis";
import { clearTripFlag, readTripFlag, setTripFlag } from "./trip-flag";
import styles from "./connect.module.css";

/** Where the transcript lives in myUNT, as the steps and errors say it. */
const MYUNT_PATH = "Academic Records, then Unofficial Transcript";

/** The reading steps appear only when reading takes at least this long (HANDOFF.md §4); quicker reads go straight to review. */
const SHOW_READING_AFTER_MS = 400;

type Problem = { kind: ImportProblem["kind"]; message: string; document: ImportProblem["document"] };
type Settled = { phase: "start" } | { phase: "problem"; problem: Problem } | { phase: "review"; result: TranscriptReconcileResult };
/** `run` numbers the read, so the delay before showing its steps belongs to it alone. */
type Phase = Settled | { phase: "reading"; run: number; stage: ParseStage; behind: Settled };

function problemOf(error: unknown): Problem {
  if (error instanceof ImportProblem) return { kind: error.kind, message: error.message, document: error.document };
  return { kind: "unreadable", message: "This PDF couldn't be read. Try the file again, or download it again from myUNT.", document: null };
}

/**
 * /connect: the first visit and every later import (DESIGN.md §4.1). One
 * column, one step at a time, one primary button per step. Open myUNT
 * opens the transcript page in a popup (myunt-trip.ts); coming back leads
 * with "Use the downloaded PDF". The PDF is read in this browser and never
 * uploaded. Its own top bar holds only the wordmark and the account,
 * because the lenses have nothing to show before a transcript.
 */
export function ImportPage() {
  const isClient = useIsClient();
  const session = authClient.useSession();
  // Signing in or out mid-import starts over: the review rows belong to whoever chose the file.
  const identity = session.data?.user.id ? `user:${session.data.user.id}` : "guest";
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" className={styles.wordmark}>
          UNTangle
        </Link>
        <AccountMenu />
      </header>
      {isClient ? <ImportSession identity={identity} identityReady={!session.isPending} /> : <main className={styles.welcome} />}
    </div>
  );
}

/**
 * Reads the trip flag once for this visit, before the flow is keyed by who
 * is signed in: on a phone that reloaded mid-trip the session resolves after
 * the first render, and the remount must still come back on "Use the
 * downloaded PDF". The flag is cleared once read and again on leaving.
 */
function ImportSession({ identity, identityReady }: { identity: string; identityReady: boolean }) {
  const [restoredTrip] = useState(readTripFlag);
  useEffect(() => {
    clearTripFlag();
    return () => clearTripFlag();
  }, []);
  return <ImportFlow key={identity} identityReady={identityReady} restoredTrip={restoredTrip} />;
}

function ImportFlow({ identityReady, restoredTrip }: { identityReady: boolean; restoredTrip: boolean }) {
  const router = useRouter();
  const phone = useMediaQuery(PHONE_QUERY);
  const { applyTranscriptRecords, hydrated, conflict } = usePlanner();
  const [phase, setPhase] = useState<Phase>({ phase: "start" });
  // The read whose steps are showing: set once it has taken SHOW_READING_AFTER_MS.
  const [slowRun, setSlowRun] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, CheckDecision>>({});
  // The trip survives a reload through a tab-only flag (phones reload during the trip to Safari); ImportSession read it.
  const { trip, openFromLink, showPopup } = useMyUntTrip((): Trip => (restoredTrip ? { stage: "back" } : { stage: "idle" }), setTripFlag);
  const active = useRef<AbortController | null>(null);
  const run = useRef(0);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfButton = useRef<HTMLButtonElement>(null);

  // An aborted read settles without touching state (read() checks the signal).
  useEffect(() => () => active.current?.abort(), []);

  const slow = phase.phase === "reading" && slowRun === phase.run;
  const shown: Settled | null = phase.phase === "reading" ? (slow ? null : phase.behind) : phase;
  const screen = shown ? (shown.phase === "start" ? `start-${trip.stage}` : shown.phase) : "reading";
  // Each new screen moves focus to its heading so the change is announced; coming back from
  // myUNT puts it on "Use the downloaded PDF" instead, without pressing it (the picker needs a click).
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    if (screen === "start-back") pdfButton.current?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }, [screen]);

  const readingRun = phase.phase === "reading" ? phase.run : null;
  useEffect(() => {
    if (readingRun === null) return;
    const timer = window.setTimeout(() => setSlowRun(readingRun), SHOW_READING_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [readingRun]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    return ++run.current;
  }

  async function read(file: File | undefined) {
    if (!file || !identityReady) return;
    // The file is here: the trip to myUNT is over.
    clearTripFlag();
    const id = cancel();
    const controller = new AbortController();
    active.current = controller;
    const behind: Settled = phase.phase === "reading" ? phase.behind : phase;
    setPhase({ phase: "reading", run: id, stage: "read", behind });
    try {
      const result = await parseConnectTranscript(file, controller.signal, (stage) => {
        if (run.current === id) setPhase({ phase: "reading", run: id, stage, behind });
      });
      if (run.current !== id) return;
      setDecisions({});
      setPhase({ phase: "review", result });
    } catch (error) {
      if (run.current === id && !controller.signal.aborted) setPhase({ phase: "problem", problem: problemOf(error) });
    }
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
      if (picked.kind === "file") void read(picked.file);
      else if (picked.kind === "fallback") fileInput.current?.click();
    });
  }

  function takeDrop(result: DropResult) {
    if (result.kind === "file") {
      void read(result.file);
      return;
    }
    cancel();
    setPhase({ phase: "problem", problem: { kind: "unreadable", message: result.message, document: null } });
  }
  // A transcript dropped on another page arrives with the navigation here.
  const takeHandedOver = useEffectEvent(() => {
    const handed = takeHandedDrop();
    if (handed) takeDrop(handed);
  });
  useEffect(() => {
    if (identityReady) takeHandedOver();
  }, [identityReady]);

  function save(result: TranscriptReconcileResult) {
    const selected = importSelection(result.records, decisions);
    if (!selected.length || !identityReady || !hydrated || conflict) return;
    applyTranscriptRecords(selected);
    toast(`Added ${selected.length} ${selected.length === 1 ? "course" : "courses"} from your transcript`);
    router.push("/courses");
  }

  const openMyUnt = (label: string, variant: "primary" | "secondary" | "quiet", size?: "lg") => (
    <a
      className={`ui-btn ui-btn--${variant}${size ? ` ui-btn--${size}` : ""}`}
      href={MYUNT_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openFromLink}
      data-ui=""
    >
      <span className="ui-btn__stack">
        <span className="ui-btn__label">
          {variant === "primary" ? (
            <span className="ui-btn__icon">
              <WindowGlyph />
            </span>
          ) : null}
          {label}
          <span className="sr-only-v2"> (opens a new window)</span>
        </span>
      </span>
    </a>
  );
  const chooseFile = (
    <button type="button" className={styles.inlineAction} disabled={!identityReady} onClick={choosePdf}>
      Choose file
    </button>
  );
  const hasPicker = typeof window !== "undefined" && filePicker(window as unknown as PickerHost) !== null;

  const matching = phase.phase === "reading" && phase.stage === "match";
  let body: ReactNode;
  if (!shown) {
    body = (
      <>
        <h1 className={styles.h2} ref={heading} tabIndex={-1}>
          Reading your transcript
        </h1>
        <PathLine label="Reading steps" className={styles.steps}>
          <ReadingStep n={1} state={matching ? "done" : "active"} leg={matching ? "done" : "todo"}>
            Reading the PDF
          </ReadingStep>
          <ReadingStep n={2} state={matching ? "active" : "todo"}>
            Finding your courses
          </ReadingStep>
        </PathLine>
        <p className={styles.hint} role="status">
          On this device. Nothing is uploaded.
        </p>
      </>
    );
  } else if (shown.phase === "review") {
    body = (
      <ImportReview
        result={shown.result}
        decisions={decisions}
        onDecide={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))}
        headingRef={heading}
        canSave={identityReady && hydrated && !conflict}
        onSave={() => save(shown.result)}
        onChooseAnother={choosePdf}
        conflictNotice={conflict ? <PlannerPersistencePanel /> : null}
      />
    );
  } else if (shown.phase === "problem") {
    const { problem } = shown;
    const title =
      problem.kind === "notext"
        ? "This PDF has no readable text"
        : problem.kind === "wrongfile"
          ? problem.document === "degree audit"
            ? "That PDF is a degree audit"
            : "That PDF isn't a transcript"
          : "That file didn't import";
    const lede =
      problem.kind === "notext"
        ? "It looks like a scan or a photo. Download the transcript again from myUNT; the original PDF works."
        : problem.kind === "wrongfile"
          ? `UNTangle needs the unofficial transcript. In myUNT, open ${MYUNT_PATH} and download that one.`
          : problem.message;
    body = (
      <>
        <span className={styles.errMark}>
          <AlertGlyph />
        </span>
        <h1 className={styles.h2} ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p className={styles.lede} role="alert">
          {lede}
        </p>
        <div className={styles.actions}>
          {problem.kind === "notext" ? (
            <>
              {openMyUnt("Open myUNT again", "primary")}
              <Button variant="quiet" disabled={!identityReady} onClick={choosePdf}>
                Choose another file
              </Button>
            </>
          ) : (
            <>
              <Button disabled={!identityReady} onClick={choosePdf}>
                Choose another file
              </Button>
              {openMyUnt("Open myUNT again", "quiet")}
            </>
          )}
        </div>
      </>
    );
  } else if (trip.stage === "away") {
    // A phone opens the popup as a tab, and a blocked popup fell back to one.
    const tab = trip.via === "tab" || phone;
    body = (
      <>
        <span className={styles.status}>{tab ? "myUNT opened in a new tab" : "myUNT is open in another window"}</span>
        <h1 className={styles.h2} ref={heading} tabIndex={-1}>
          Download your transcript there
        </h1>
        <PathLine label="In myUNT" className={styles.steps}>
          <PathStop marker="1" leg="done">
            <div className={styles.step}>
              <strong>Sign in with your EUID</strong>
              <span className={styles.meta}>UNTangle never sees your password.</span>
            </div>
          </PathStop>
          <PathStop marker="2" leg="done">
            <div className={styles.step}>
              <strong>Open your unofficial transcript</strong>
              <span className={styles.meta}>{MYUNT_PATH}</span>
            </div>
          </PathStop>
          <PathStop marker="3">
            <div className={styles.step}>
              <strong>Download it as a PDF</strong>
              <span className={styles.meta}>It lands in your Downloads folder.</span>
            </div>
          </PathStop>
        </PathLine>
        <div className={styles.actions}>
          {tab ? null : (
            <Button variant="secondary" icon={<WindowGlyph />} onClick={showPopup}>
              Show the myUNT window
            </Button>
          )}
          <Button variant={tab ? "primary" : "quiet"} size={tab ? "lg" : "md"} className={tab ? styles.wide : undefined} disabled={!identityReady} onClick={choosePdf}>
            I have the PDF
          </Button>
        </div>
        <p className={`${styles.hint} ${styles.fineOnly}`}>You can also drop the PDF anywhere on this page.</p>
      </>
    );
  } else if (trip.stage === "back") {
    body = (
      <>
        <h1 className={styles.h2} ref={heading} tabIndex={-1}>
          Got it downloaded?
        </h1>
        <p className={styles.lede}>Pick the PDF you just saved and UNTangle reads it here.</p>
        <div className={styles.cta}>
          <Button ref={pdfButton} size="lg" className={styles.wide} icon={<FileGlyph />} disabled={!identityReady} onClick={choosePdf}>
            Use the downloaded PDF
          </Button>
          <p className={styles.meta}>{hasPicker ? "Opens your Downloads folder." : "Look in Files, then Downloads."}</p>
        </div>
        <p className={styles.alt}>
          {openMyUnt("Open myUNT again", "quiet")}
          <span className={styles.fineOnly}>or drop the PDF here</span>
        </p>
      </>
    );
  } else {
    body = (
      <>
        <h1 className={styles.h1} ref={heading} tabIndex={-1}>
          Start with your transcript
        </h1>
        <p className={styles.lede}>UNTangle reads it on this device and shows what you can take next. Nothing is uploaded.</p>
        <div className={styles.cta}>
          {openMyUnt("Open myUNT", "primary", "lg")}
          <p className={styles.meta}>Opens in a small window. Sign in there and download your unofficial transcript.</p>
        </div>
        <p className={styles.alt}>
          Have the PDF already? {chooseFile}
          <span className={styles.fineOnly}>or drop it on this page.</span>
        </p>
        <div className={styles.skip}>
          <Link href="/courses" className="ui-btn ui-btn--ink ui-btn--sm" data-ui="">
            Browse courses without a transcript
          </Link>
        </div>
      </>
    );
  }

  return (
    <main className={styles.welcome}>
      <PdfDropTarget onDrop={takeDrop} />
      <HiddenPdfInput ref={fileInput} onFile={(file) => void read(file)} />
      <Stage key={screen}>{body}</Stage>
      {screen === "start-idle" ? <Thesis /> : null}
    </main>
  );
}

/**
 * One screen of the flow. A new screen fades in with a 2px blur and a 4px
 * rise (MOTION.md §3, "Import state changes"); one reached from the
 * keyboard appears at once. Heights snap.
 */
function Stage({ children }: { children: ReactNode }) {
  const [instant] = useState(() => keyboardFocused());
  return (
    // data-ui: the stage declares its own reduced-motion fade, so globals.css leaves it alone.
    <section className={styles.stage} data-instant={instant ? "" : undefined} data-ui="">
      {children}
    </section>
  );
}

function ReadingStep({ n, state, leg, children }: { n: number; state: "active" | "done" | "todo"; leg?: "done" | "todo"; children: ReactNode }) {
  return (
    <PathStop
      marker={state === "active" ? <Spinner size={14} /> : state === "done" ? <Check size={14} /> : String(n)}
      tone={state === "todo" ? "ring" : "default"}
      leg={leg}
    >
      <div className={styles.step} data-state={state}>
        <strong>{children}</strong>
      </div>
    </PathStop>
  );
}
