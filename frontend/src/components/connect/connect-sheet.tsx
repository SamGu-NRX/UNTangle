"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type RefObject } from "react";
import { authClient } from "@/lib/auth-client";
import { ConnectReviewRow } from "./connect-review-row";
import { ConnectPersistence } from "./connect-persistence";
import { usePlanner } from "@/components/planner-provider";
import { exchange, ConnectError, errorText } from "@/lib/connect/client";
import { parseConnectTranscript } from "@/lib/connect/import";
import { missingApprovedRecords } from "@/lib/connect/import-confirmation";
import { selectApprovedTranscriptRecords, type TranscriptReconcileResult } from "@/lib/transcript-import";
import type { TranscriptAppliedStatus, TranscriptCourseRecord } from "@/lib/types";
import type { Payload } from "@/lib/connect/protocol";
import { Checkbox } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/icons";
import { BrowserCard, DropZone, ExtensionRow, StepDots, UploadInput } from "./connect-parts";
import styles from "./connect.module.css";
type State =
  | { phase: "permission" }
  | { phase: "waiting"; stage: "waiting" | "reading" }
  | { phase: "parsing" }
  | { phase: "error"; message: string; install: boolean }
  | { phase: "review"; result: TranscriptReconcileResult }
  | { phase: "saved"; records: TranscriptCourseRecord[] };
const MYUNT_LINK = "https://my.unt.edu/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN.GBL";

/**
 * Remembers, for this tab only, that the student went to myUNT to download
 * the PDF by hand. On a phone the trip to Safari can reload this page; the
 * sheet then reopens on "choose the PDF" instead of starting over. It holds
 * a flag only: no consent, no transcript data.
 */
const MANUAL_KEY = "untangle.connect.manual";
/** `true` when the flag is set; `null` when no choice was stored, so the device decides. */
function readManual(): true | null {
  try {
    return sessionStorage.getItem(MANUAL_KEY) === "1" ? true : null;
  } catch {
    return null;
  }
}
function writeManual(on: boolean) {
  try {
    if (on) sessionStorage.setItem(MANUAL_KEY, "1");
    else sessionStorage.removeItem(MANUAL_KEY);
  } catch {
    // Storage denied: the sheet still works, it just will not survive a reload.
  }
}

const COARSE = "(pointer: coarse)";
const subscribeCoarse = (onChange: () => void) => {
  const list = window.matchMedia(COARSE);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};
/** Touch-first devices: phone browsers can't load the desktop extension. */
function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);
}

type SheetProps = {
  /** Focused when a phase begins, and by the host when the sheet opens. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
};

export function ConnectSheet(props: SheetProps) {
  const session = authClient.useSession();
  // Remounting cancels the old identity's work and drops its consent, review rows, and approvals together.
  const identity = session.data?.user.id ? `user:${session.data.user.id}` : "guest";
  return <IdentityConnectSheet key={identity} identityReady={!session.isPending} {...props} />;
}

function IdentityConnectSheet({ identityReady, headingRef, onClose }: SheetProps & { identityReady: boolean }) {
  const { applyTranscriptRecords, hydrated, plannerState, conflict } = usePlanner();
  const router = useRouter();
  const coarse = useCoarsePointer();
  const [state, setState] = useState<State>({ phase: "permission" });
  const [consent, setConsent] = useState(false);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, TranscriptAppliedStatus>>({});
  const [dragging, setDragging] = useState(false);
  // Presentation only: which permission-phase view shows. "manual" is the
  // download-it-yourself path (phones, no extension).
  // An explicit choice (this visit or stored) wins; with none, touch-first
  // devices start on the manual path and others on the extension.
  const [manual, setManual] = useState<boolean | null>(readManual);
  const active = useRef<AbortController | null>(null);
  const run = useRef(0);
  const heading = headingRef;
  const connectButton = useRef<HTMLButtonElement>(null);
  const restoreConnectFocus = useRef(false);
  useEffect(
    () => () => {
      active.current?.abort();
      run.current++;
    },
    [],
  );
  // Opening focus is the host's (Dialog/BottomSheet initialFocus), so the
  // modal layer records the opener first and can return focus to it on
  // close. From then on each step change moves focus to the new heading.
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    if (state.phase === "permission" && restoreConnectFocus.current) {
      restoreConnectFocus.current = false;
      connectButton.current?.focus();
    } else heading.current?.focus();
  }, [state.phase, heading]);
  function cancel() {
    active.current?.abort();
    active.current = null;
    return ++run.current;
  }
  async function parse(input: File | Payload, id: number, signal: AbortSignal) {
    setState({ phase: "parsing" });
    const result = await parseConnectTranscript(input, signal);
    if (run.current !== id) return;
    setIncluded(new Set());
    setOverrides({});
    setState({ phase: "review", result });
  }
  async function connect() {
    const id = cancel();
    if (!consent || !identityReady) {
      restoreConnectFocus.current = true;
      setState({ phase: "permission" });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ phase: "waiting", stage: "waiting" });
    try {
      await exchange("hello", () => {}, controller.signal);
      const payload = await exchange(
        "transcript",
        (stage) => {
          if (run.current === id) setState({ phase: "waiting", stage });
        },
        controller.signal,
      );
      if (run.current !== id || payload === "ready") return;
      await parse(payload, id, controller.signal);
    } catch (error) {
      if (run.current !== id) return;
      setState({
        phase: "error",
        message:
          error instanceof ConnectError
            ? errorText[error.reason]
            : error instanceof Error
              ? error.message
              : "Import failed. Upload your PDF below.",
        install: error instanceof ConnectError && error.reason === "NO_EXTENSION",
      });
    }
  }
  async function upload(file: File | undefined) {
    if (!file || !identityReady) return;
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
          install: false,
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

  // ---------- presentation ----------

  function backToPermission() {
    cancel();
    restoreConnectFocus.current = true;
    setState({ phase: "permission" });
  }
  function goManual(on: boolean) {
    writeManual(on);
    setManual(on);
  }
  // A drop anywhere on the sheet counts, while a PDF is expected.
  const acceptsDrop = state.phase === "permission" || state.phase === "waiting" || state.phase === "error";
  const dropHandlers = acceptsDrop
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        },
      }
    : {};

  const reading = state.phase === "parsing" || (state.phase === "waiting" && state.stage === "reading");
  const showManual =
    (state.phase === "permission" && (manual ?? coarse)) || (state.phase === "error" && state.install);
  const title =
    state.phase === "review"
      ? "Review your courses"
      : state.phase === "saved"
        ? missingRecords.length
          ? "Review your import"
          : "Your courses are ready"
        : reading
          ? "Reading your transcript"
          : state.phase === "error" && !state.install
            ? "That file didn't import"
            : "Connect myUNT";
  const dots =
    state.phase === "review" ? 2 : state.phase === "saved" ? 3 : reading ? 1 : 0;
  const uploadInstead = (
    <label className={styles.uploadLink}>
      <UploadInput disabled={!identityReady} onFile={(file) => void upload(file)} />
      Upload a PDF instead
    </label>
  );

  return (
    <section className={styles.sheet} aria-labelledby="connect-title" data-phase={state.phase} {...dropHandlers}>
      <StepDots current={dots} />
      {state.phase === "permission" && !showManual ? (
        <span className={styles.seal} aria-hidden="true">
          U
        </span>
      ) : state.phase === "saved" && !missingRecords.length ? (
        <span className={styles.seal} data-tone="ok" aria-hidden="true">
          ✓
        </span>
      ) : state.phase === "error" && !state.install ? (
        <span className={styles.seal} data-tone="error" aria-hidden="true">
          !
        </span>
      ) : null}
      <h2 id="connect-title" ref={heading} tabIndex={-1} className={styles.title}>
        {title}
      </h2>

      {state.phase === "permission" && !showManual && (
        <>
          <p className={styles.lead}>UNTangle will import your unofficial transcript. It reads only that page, in your browser.</p>
          <ul className={styles.access}>
            <li>
              <AccessGlyph kind="reads" />
              <span>
                <strong>Reads</strong> course codes, terms and grades
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
          <p className={styles.quiet}>You sign in to myUNT yourself. Your password and Duo stay with UNT.</p>
          <Checkbox
            className={styles.consent}
            disabled={!identityReady}
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            label="I allow UNTangle to read my unofficial transcript."
          />
          <div className={styles.foot}>
            <button
              ref={connectButton}
              type="button"
              className="ui-btn ui-btn--primary"
              disabled={!consent || !identityReady}
              onClick={() => void connect()}
              data-ui=""
            >
              Connect myUNT <span aria-hidden="true" className={styles.trail}>→</span>
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose} data-ui="">
              Not now
            </button>
          </div>
          <div className={styles.fallback}>
            {uploadInstead}
            <span aria-hidden="true">·</span>
            <button type="button" className={styles.linkButton} onClick={() => goManual(true)}>
              No extension? Download the PDF yourself
            </button>
          </div>
        </>
      )}

      {showManual && (
        <>
          {state.phase === "error" ? (
            <p className={styles.alert} role="alert">
              {state.message}
            </p>
          ) : (
            <p className={styles.lead}>
              In myUNT: Academic Records › Unofficial Transcript › View as PDF. Then bring the PDF back here.
            </p>
          )}
          <BrowserCard href={MYUNT_LINK} onOpen={() => goManual(true)} />
          <DropZone dragging={dragging} disabled={!identityReady} onFile={(file) => void upload(file)} />
          <p className={styles.quiet}>The PDF is read in this browser. It isn&apos;t uploaded or stored.</p>
          <div className={styles.foot}>
            {state.phase === "error" ? (
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void connect()} data-ui="">
                Try Connect again
              </button>
            ) : coarse ? (
              <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose} data-ui="">
                Not now
              </button>
            ) : (
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => goManual(false)} data-ui="">
                Back
              </button>
            )}
          </div>
          {coarse && state.phase === "permission" ? (
            // A touch-first device can still run desktop Chrome with the
            // extension (a touch-only tablet): leave it a way to Connect.
            <button type="button" className={`${styles.linkButton} ${styles.linkQuiet}`} onClick={() => goManual(false)}>
              Have the UNTangle extension? Connect instead
            </button>
          ) : null}
          {!coarse && <InstallHelp open={state.phase === "error"} />}
        </>
      )}

      {state.phase === "waiting" && state.stage === "waiting" && (
        <>
          <ExtensionRow />
          <p role="status" className={styles.lead}>
            Waiting for your approval…
          </p>
          <BrowserCard href={MYUNT_LINK}>
            <p>Academic Records › View Unofficial Transcript › Submit › View Report.</p>
          </BrowserCard>
          <p className={styles.detail}>
            Then open the UNTangle extension, check the requesting origin and press Send to UNTangle. Leave this tab
            open; Connect waits up to 90 seconds.
          </p>
          <div className={styles.foot}>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={backToPermission} data-ui="">
              Cancel connection
            </button>
          </div>
          <div className={styles.fallback}>{uploadInstead}</div>
        </>
      )}

      {reading && (
        <>
          <p role="status" className={styles.lead}>
            {state.phase === "waiting" ? "Reading your report…" : "Reading courses in your browser…"}
          </p>
          <ol className={styles.progress}>
            <li data-state={state.phase === "parsing" ? "done" : "active"}>
              <ProgressIcon state={state.phase === "parsing" ? "done" : "active"} />
              Get the PDF
            </li>
            <li data-state={state.phase === "parsing" ? "active" : "pending"}>
              <ProgressIcon state={state.phase === "parsing" ? "active" : "pending"} />
              Read it and remove labeled identity fields
            </li>
            <li data-state="pending">
              <ProgressIcon state="pending" />
              Match courses to your plan
            </li>
          </ol>
          <p className={styles.quiet}>This happens in your browser. The PDF is not uploaded.</p>
          <div className={styles.foot}>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={backToPermission} data-ui="">
              {state.phase === "parsing" ? "Cancel import" : "Cancel connection"}
            </button>
          </div>
        </>
      )}

      {state.phase === "error" && !state.install && (
        <>
          <p className={styles.alert} role="alert">
            {state.message}
          </p>
          <p className={styles.detail}>Your plan is unchanged.</p>
          <div className={styles.foot}>
            <label className="ui-btn ui-btn--primary" data-ui="">
              <UploadInput disabled={!identityReady} onFile={(file) => void upload(file)} />
              Choose another file
            </label>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void connect()} data-ui="">
              Try Connect again
            </button>
          </div>
        </>
      )}

      {state.phase === "review" && (
        <>
          <p className={styles.summary}>
            {state.result.records.length} courses found
            {state.result.records.some((r) => r.reviewRequired)
              ? ` · ${state.result.records.filter((r) => r.reviewRequired).length} need your decision`
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
            <button type="button" className="ui-btn ui-btn--ghost" onClick={backToPermission} data-ui="">
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
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => {
                writeManual(false);
                router.push("/courses");
              }}
              data-ui=""
            >
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

/** How to load the development extension; collapsed unless Connect just failed to find it. */
function InstallHelp({ open }: { open: boolean }) {
  return (
    <details className={styles.install} open={open}>
      <summary>Use the desktop extension to skip this step</summary>
      <ol>
        <li>
          Build the extension with <code>bun run build:dev</code> in <code>extension</code>.
        </li>
        <li>
          Open <code>chrome://extensions</code> in desktop Chromium and turn on Developer mode.
        </li>
        <li>
          Choose Load unpacked and select <code>extension/dist-dev</code>.
        </li>
        <li>Reload this page, then try Connect again.</li>
      </ol>
      <p>Phone browsers can&apos;t load this extension. Upload works on your phone.</p>
    </details>
  );
}
