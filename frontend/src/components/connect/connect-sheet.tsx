"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { exchange, ConnectError, errorText } from "@/lib/connect/client";
import { parseConnectTranscript } from "@/lib/connect/import";
import { selectApprovedTranscriptRecords, type TranscriptReconcileResult } from "@/lib/transcript-import";
import type { TranscriptAppliedStatus } from "@/lib/types";
import type { Payload } from "@/lib/connect/protocol";
import { BrowserCard, StepDots } from "./connect-parts";
import styles from "./connect.module.css";
type State = { phase: "permission" } | { phase: "waiting"; stage: "waiting" | "reading" } | { phase: "parsing" } | { phase: "error"; message: string; install: boolean } | { phase: "review"; result: TranscriptReconcileResult } | { phase: "saved"; count: number };
const MYUNT_LINK = "https://my.unt.edu/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN.GBL";
export function ConnectSheet() {
  const { applyTranscriptRecords, hydrated, saveState, retrySave, isRegistered } = usePlanner();
  const [state, setState] = useState<State>({ phase: "permission" });
  const [consent, setConsent] = useState(false);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, TranscriptAppliedStatus>>({});
  const [dragging, setDragging] = useState(false);
  const active = useRef<AbortController | null>(null);
  const run = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const restoreConnectFocus = useRef(false);
  useEffect(() => () => { active.current?.abort(); run.current++; }, []);
  useEffect(() => {
    if (state.phase === "permission" && restoreConnectFocus.current) { restoreConnectFocus.current = false; connectButton.current?.focus(); }
    else heading.current?.focus();
  }, [state.phase]);
  function cancel() { active.current?.abort(); active.current = null; return ++run.current; }
  async function parse(input: File | Payload, id: number, signal: AbortSignal) {
    setState({ phase: "parsing" });
    const result = await parseConnectTranscript(input, signal);
    if (run.current !== id) return;
    setIncluded(new Set()); setOverrides({}); setState({ phase: "review", result });
  }
  async function connect() {
    const id = cancel();
    const controller = new AbortController(); active.current = controller;
    setState({ phase: "waiting", stage: "waiting" });
    try {
      await exchange("hello", () => {}, controller.signal);
      const payload = await exchange("transcript", stage => { if (run.current === id) setState({ phase: "waiting", stage }); }, controller.signal);
      if (run.current !== id || payload === "ready") return;
      await parse(payload, id, controller.signal);
    } catch (error) {
      if (run.current !== id) return;
      setState({ phase: "error", message: error instanceof ConnectError ? errorText[error.reason] : error instanceof Error ? error.message : "Import failed. Upload your PDF below.", install: error instanceof ConnectError && error.reason === "NO_EXTENSION" });
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    const id = cancel();
    const controller = new AbortController(); active.current = controller;
    try { await parse(file, id, controller.signal); }
    catch (error) { if (run.current === id) setState({ phase: "error", message: error instanceof Error ? error.message : "This PDF couldn't be read. Try another file.", install: false }); }
  }
  const selected = state.phase === "review" ? selectApprovedTranscriptRecords(state.result.records, included, overrides) : [];
  function save() {
    if (!selected.length) return;
    applyTranscriptRecords(selected);
    setState({ phase: "saved", count: selected.length });
  }
  const title = state.phase === "review" ? "Review your courses" : state.phase === "saved" ? "Your courses are ready" : "Connect myUNT";
  return <main className={styles.page}>
    <div className={styles.frame}>
      <header className={styles.chrome}><Link href="/courses" aria-label="Back to courses">← Courses</Link><span>UNTangle</span><span className={styles.secure}>In your browser</span></header>
      <section className={styles.sheet} aria-labelledby="connect-title">
        <StepDots current={state.phase === "review" ? 2 : state.phase === "saved" ? 3 : state.phase === "parsing" || state.phase === "waiting" && state.stage === "reading" ? 1 : 0} />
        {state.phase === "permission" && <span className={styles.seal} aria-hidden="true">U</span>}
        <h1 id="connect-title" ref={heading} tabIndex={-1}>{title}</h1>
        {state.phase === "permission" && <>
          <p className={styles.lead}>Bring the courses you&apos;ve already taken into your plan.</p>
          <p>UNTangle will import your unofficial transcript. It reads only that page, in your browser.</p><ul className={styles.access}><li><strong>Reads</strong> course codes, terms and grades</li><li><strong>Removes</strong> labeled identity fields before matching</li><li><strong>Keeps</strong> the course list you approve in your plan</li></ul>
          <p className={styles.detail}>You sign in to myUNT yourself. Your password and Duo stay with UNT. Review the courses before saving. The PDF stays in this browser.</p>
          <label className={styles.check}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I allow UNTangle to read my unofficial transcript.</label>
          <button ref={connectButton} className={styles.primary} disabled={!consent} onClick={() => void connect()}>Connect myUNT <span aria-hidden="true">→</span></button>
        </>}
        {state.phase === "waiting" && <div className={styles.waiting}>
          <span className={styles.spinner} aria-hidden="true" />
          <p role="status" className={styles.lead}>{state.stage === "reading" ? "Reading your report…" : "Waiting for your transcript…"}</p>
          <p>In myUNT, choose Academic Records → View Unofficial Transcript → Submit → View Report.</p>
          <p className={styles.detail}>Leave this tab open. Connect waits up to 90 seconds.</p>
          <button className={styles.textButton} onClick={() => { cancel(); restoreConnectFocus.current = true; setState({ phase: "permission" }); }}>Cancel connection</button>
        </div>}
        {state.phase === "permission" ? <a className={styles.help} href={MYUNT_LINK} target="_blank" rel="noopener noreferrer">Open myUNT ↗</a> : state.phase !== "review" && state.phase !== "saved" && <BrowserCard href={MYUNT_LINK} />}
        {state.phase === "parsing" && <div><p role="status" className={styles.parsing}><span className={styles.spinner} aria-hidden="true" />Reading courses in your browser…</p><ol className={styles.progressSteps}><li>Read the PDF</li><li>Remove labeled identity fields</li><li>Match courses to your plan</li></ol><button className={styles.textButton} onClick={() => { cancel(); restoreConnectFocus.current = true; setState({ phase: "permission" }); }}>Cancel import</button></div>}
        {state.phase === "error" && <div className={styles.error} role="alert"><p>{state.message}</p><button className={styles.textButton} onClick={() => void connect()}>Try Connect again</button>{state.install && <details open><summary>Install the desktop extension</summary><ol><li>Build the extension with <code>bun run build:dev</code> in <code>extension</code>.</li><li>Open <code>chrome://extensions</code> in desktop Chromium and turn on Developer mode.</li><li>Choose Load unpacked and select <code>extension/dist-dev</code>.</li><li>Reload this page, then try Connect again.</li></ol><p>Phone browsers generally can&apos;t load this extension. Upload works on your phone.</p></details>}</div>}
        {state.phase === "review" && <>
          <p className={styles.lead}>{state.result.records.length} courses found. Choose which ones to add.</p>
          <p className={styles.detail}>Check each grade and term. Uncertain rows need your decision. Nothing is saved until you choose Save.</p>
          <ul className={styles.records}>{state.result.records.map(record => {
            const status = overrides[record.id] ?? record.appliedStatus;
            const eligible = status === "completed" || status === "inProgress";
            return <li key={record.id}><label className={styles.row}><input type="checkbox" aria-label={`Include ${record.code}`} checked={included.has(record.id)} disabled={!eligible} onChange={e => setIncluded(current => { const next = new Set(current); if (e.target.checked) next.add(record.id); else next.delete(record.id); return next; })} /><span><strong>{record.code}</strong><span>{record.title}</span><small>{record.term} · Grade {record.grade || "unknown"} · {record.credits ?? "?"} credits</small></span></label><details className={styles.exception}><summary>{record.reviewRequired ? "Review this course" : "Change detected status"}</summary><label className={styles.decision}>Apply as<select aria-label={`Status for ${record.code}`} value={status} onChange={e => { const next = e.target.value as TranscriptAppliedStatus; setOverrides(current => ({ ...current, [record.id]: next })); setIncluded(current => { const updated = new Set(current); updated.delete(record.id); return updated; }); }}><option value="completed">Completed</option><option value="inProgress">In progress</option><option value="needsReview">Needs review</option><option value="ignored">Ignore</option></select></label></details>{record.reviewRequired && <p className={styles.note}>{record.rationale}</p>}</li>;
          })}</ul>
          <button className={styles.primary} disabled={!selected.length || !hydrated} onClick={save}>Save {selected.length || "selected"} {selected.length === 1 ? "course" : "courses"}</button>
        </>}
        {state.phase === "saved" && <div role="status"><p className={styles.lead}>{state.count} {state.count === 1 ? "course" : "courses"} added to your plan.</p><p className={styles.detail}>Your original PDF wasn&apos;t stored. Check your courses, then keep planning.</p><p>{saveState.status === "saved" ? isRegistered ? "Saved to your account." : "Saved in this browser." : saveState.status === "pending" || saveState.status === "saving" ? "Saving your plan…" : saveState.detail || "Your plan has not been saved yet."}</p>{["failed", "not-saved"].includes(saveState.status) && <button className={styles.textButton} onClick={retrySave}>Retry saving</button>}<Link className={styles.primary} href="/courses">Review my plan →</Link></div>}
        <div className={styles.upload} data-dragging={dragging} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]); }}>
          <p>Have the PDF already?</p><p className={styles.detail}>Drop it here or choose a file. Unofficial transcript PDF, up to 12 MB.</p>
          <label className={styles.uploadButton}>Upload transcript PDF<input ref={input} type="file" accept="application/pdf,.pdf" aria-label="Upload transcript PDF" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <Link className={styles.help} href="/courses/import">Need to import a scanned PDF?</Link>
        </div>
      </section>
      <p className={styles.footer}>UNTangle is an independent planner. It doesn&apos;t register you for classes.</p>
    </div>
  </main>;
}
