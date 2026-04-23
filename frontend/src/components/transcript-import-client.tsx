"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { NavShell } from "@/components/nav-shell";
import { Button } from "@/components/ui/Button";
import { usePlanner, useToast } from "@/components/planner-provider";
import {
  buildLocalFallbackPayload,
  buildTranscriptImagePrompt,
  buildTranscriptPrompt,
  extractTranscriptJson,
  reconcileTranscriptCourses,
  type TranscriptReconcileResult,
} from "@/lib/transcript-import";
import type {
  TranscriptAppliedStatus,
  TranscriptCourseRecord,
  TranscriptImportSummary,
} from "@/lib/types";

type PuterRuntime = {
  ai: {
    chat: (prompt: string, inputOrOptions?: unknown, options?: unknown) => Promise<unknown>;
    img2txt?: (image: string) => Promise<unknown>;
  };
  auth?: {
    isSignedIn?: () => boolean | Promise<boolean>;
    signIn?: () => Promise<unknown>;
  };
  fs?: {
    write?: (path: string, content: Blob | File | string) => Promise<unknown>;
    getReadURL?: (path: string) => Promise<string>;
    delete?: (path: string) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    puter?: PuterRuntime;
  }
}

type ScriptStatus = "loading" | "ready" | "auth-required" | "error";
type PhaseStatus = "pending" | "running" | "done" | "error";
type PhaseId = "read" | "privacy" | "prepare" | "analyze" | "policy" | "ready";

type Phase = {
  id: PhaseId;
  label: string;
  status: PhaseStatus;
  note: string;
};

type PdfExtraction = {
  text: string;
  pageImages: string[];
  pageCount: number;
  extractionMode: TranscriptImportSummary["extractionMode"];
};

type PhaseReporter = (id: PhaseId, status: PhaseStatus, note?: string) => void;

const maxPdfBytes = 12 * 1024 * 1024;
const textMinimum = 600;
const puterScriptUrl = "https://js.puter.com/v2/";
const models = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "openai/gpt-5.4", label: "OpenAI GPT-5.4" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { id: "openai/gpt-5.4-nano", label: "OpenAI GPT-5.4 nano" },
  { id: "gpt-5-nano", label: "GPT-5 nano" },
  { id: "openai/gpt-5-nano", label: "OpenAI GPT-5 nano" },
] as const;
const phases: Array<Pick<Phase, "id" | "label">> = [
  { id: "read", label: "Reading PDF" },
  { id: "privacy", label: "Redacting private fields" },
  { id: "prepare", label: "Preparing pages" },
  { id: "analyze", label: "Analyzing transcript" },
  { id: "policy", label: "Checking grades" },
  { id: "ready", label: "Ready to save" },
];

function initialPhases(): Phase[] {
  return phases.map((phase) => ({ ...phase, status: "pending", note: "" }));
}

function phaseStatusLabel(status: PhaseStatus) {
  if (status === "done") return "Completed";
  if (status === "running") return "In progress";
  if (status === "error") return "Needs attention";
  return "Waiting";
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isSparseTranscriptText(text: string) {
  const codeMatches = text.match(/\b[A-Z]{2,5}\s*\d{4}\b/g)?.length ?? 0;
  return text.trim().length < textMinimum || codeMatches < 4;
}

function responseText(error: unknown) {
  return error instanceof Error ? error.message : "Transcript import failed.";
}

function statusText(status: TranscriptAppliedStatus) {
  if (status === "completed") return "Done";
  if (status === "inProgress") return "Taking";
  if (status === "ignored") return "Ignored";
  return "Review";
}

function extractionText(mode: TranscriptImportSummary["extractionMode"]) {
  if (mode === "rendered-pages") return "page images";
  if (mode === "local") return "browser text extraction";
  return "embedded PDF text";
}

function phaseSummaryText(phase: Phase) {
  return phase.note ? `${phase.label}: ${phase.note}` : phase.label;
}

function recordDecisionNote(record: TranscriptCourseRecord, status: TranscriptAppliedStatus) {
  if (record.confidence < 0.72) return "Low confidence";
  if (status === "needsReview" || status === "ignored") return record.rationale;
  if (record.duplicateExcluded) return "Duplicate/excluded";
  if (record.sourceKind === "transfer") return "Transfer credit";
  if (record.sourceKind === "exam") return "Exam credit";
  if (record.grade === "D") return "D grade: check prerequisites";
  if (record.grade === "P") return "Pass credit";
  return "";
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.48 6.54-4.1 4.1a.7.7 0 0 1-.99 0l-1.87-1.87a.7.7 0 0 1 .99-.99l1.38 1.37 3.6-3.6a.7.7 0 1 1 .99.99Z"
      />
    </svg>
  );
}

function BrainIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 0 1 5.8 1.1 3 3 0 0 1 1.1 5.8 3 3 0 0 1-2.9 4.7h-1.4" />
      <path d="M12 5a3 3 0 0 0-5.8 1.1 3 3 0 0 0-1.1 5.8A3 3 0 0 0 8 16.6h1.4" />
      <path d="M12 5v14" />
      <path d="M8.3 9.2H12" />
      <path d="M12 13.1h3.7" />
      <path d="M9.3 16.6A2.7 2.7 0 0 0 12 19" />
      <path d="M14.7 16.6A2.7 2.7 0 0 1 12 19" />
    </svg>
  );
}

function ThinkingIcon({ active }: { active: boolean }) {
  return (
    <span className="transcript-thinking-icon" data-active={active ? "true" : "false"} aria-hidden="true">
      <BrainIcon className="transcript-thinking-icon__brain" />
      <span className="transcript-thinking-icon__dots">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

function StepIcon({ status }: { status: PhaseStatus }) {
  if (status === "done") {
    return <CheckIcon className="transcript-step-icon transcript-step-icon--done" />;
  }

  if (status === "running") {
    return <ThinkingIcon active />;
  }

  if (status === "error") {
    return <span className="transcript-step-icon transcript-step-icon--error" aria-hidden="true">!</span>;
  }

  return <span className="transcript-step-icon transcript-step-icon--pending" aria-hidden="true" />;
}

function effectiveRecord(
  record: TranscriptCourseRecord,
  override: TranscriptAppliedStatus | undefined,
): TranscriptCourseRecord {
  if (!override || override === record.appliedStatus) return record;

  return {
    ...record,
    appliedStatus: override,
    prerequisiteSatisfied: override === "completed" ? record.grade !== "D" : false,
    reviewRequired: override === "needsReview",
    rationale:
      override === "completed" || override === "inProgress"
        ? `${record.rationale} Manually included during transcript review.`
        : record.rationale,
  };
}

function safeDataUrlForOcr(value: unknown) {
  return typeof value === "string" ? value : "";
}

function hasPuterAi(value: unknown): value is PuterRuntime {
  return Boolean(
    value &&
      typeof value === "object" &&
      "ai" in value &&
      (value as PuterRuntime).ai &&
      typeof (value as PuterRuntime).ai.chat === "function",
  );
}

async function getPuterAuthState(puter: PuterRuntime) {
  if (typeof puter.auth?.isSignedIn !== "function") return "unknown" as const;

  try {
    return (await puter.auth.isSignedIn()) ? ("signed-in" as const) : ("signed-out" as const);
  } catch {
    return "unknown" as const;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

async function waitForPuter(timeoutMs = 6000) {
  if (typeof window === "undefined") return null;
  if (hasPuterAi(window.puter)) return window.puter;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    if (hasPuterAi(window.puter)) return window.puter;
  }

  return null;
}

async function callPuterChat({
  puter,
  prompt,
  pageImages,
  model,
}: {
  puter: PuterRuntime;
  prompt: string;
  pageImages: string[];
  model: string;
}) {
  const imageInput = pageImages.length === 1 ? pageImages[0] : pageImages;
  const request =
    pageImages.length > 0
      ? puter.ai.chat(prompt, imageInput, { model })
      : puter.ai.chat(prompt, { model });

  return withTimeout(request, 14000, `${model} did not respond in time.`);
}

async function callPuterOcr(puter: PuterRuntime, image: string) {
  if (typeof puter.ai.img2txt !== "function") {
    throw new Error("Puter OCR is not available in this browser session.");
  }

  return withTimeout(puter.ai.img2txt(image), 14000, "Puter OCR did not respond in time.");
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function preparePuterImageInputs({
  puter,
  pageImages,
  addEvent,
}: {
  puter: PuterRuntime;
  pageImages: string[];
  addEvent: (message: string) => void;
}) {
  const write = puter.fs?.write;
  const getReadURL = puter.fs?.getReadURL;

  if (typeof write !== "function" || typeof getReadURL !== "function") {
    addEvent("Puter file storage was unavailable; trying direct redacted page images.");
    return {
      imageInputs: pageImages,
      cleanup: async () => {},
    };
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uploadedPaths: string[] = [];
  const imageInputs: string[] = [];
  addEvent("Uploading redacted page images to Puter for visual analysis.");

  for (let index = 0; index < pageImages.length; index += 1) {
    const path = `untangle-transcript-${runId}-page-${index + 1}.jpg`;
    const pageImage = pageImages[index];
    if (!pageImage) continue;
    const blob = await dataUrlToBlob(pageImage);
    await withTimeout(write(path, blob), 12000, `Could not upload page ${index + 1} to Puter.`);
    const readUrl = await withTimeout(
      getReadURL(path),
      12000,
      `Could not prepare page ${index + 1} for Puter vision.`,
    );

    uploadedPaths.push(path);
    imageInputs.push(readUrl);
  }

  return {
    imageInputs,
    cleanup: async () => {
      if (typeof puter.fs?.delete !== "function") return;
      await Promise.allSettled(uploadedPaths.map((path) => puter.fs?.delete?.(path)));
      addEvent("Deleted temporary redacted page images from Puter.");
    },
  };
}

function redactRenderedTranscriptPage(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  pageNumber: number,
) {
  const height = Math.round(canvas.height * (pageNumber === 1 ? 0.2 : 0.075));
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, height);
  context.fillStyle = "#6b826b";
  context.font = `${Math.max(14, Math.round(canvas.width * 0.014))}px sans-serif`;
  context.fillText("student identity redacted", Math.round(canvas.width * 0.04), Math.round(height * 0.55));
  context.restore();
}

async function extractPdf(file: File, reportPhase?: PhaseReporter): Promise<PdfExtraction> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  loadingTask.onPassword = () => {
    throw new Error("Password-protected transcript PDFs are not supported.");
  };

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  let text = "";
  const pageImages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      reportPhase?.("read", "running", `Reading page ${pageNumber} of ${pageCount}`);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => {
          if (item && typeof item === "object" && "str" in item) {
            return String((item as { str?: string }).str ?? "");
          }
          return "";
        })
        .join(" ");
      text += `${pageText}\n`;
    }
    reportPhase?.("read", "done", `${pageCount} page${pageCount === 1 ? "" : "s"}`);

    if (isSparseTranscriptText(text)) {
      reportPhase?.("privacy", "running", "Masking identity headers on rendered pages");
      reportPhase?.("prepare", "running", "Preparing page images for visual analysis");
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        reportPhase?.("prepare", "running", `Rendering page ${pageNumber} of ${pageCount}`);
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2.1, Math.max(1.35, 1500 / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Unable to prepare transcript page images.");
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        redactRenderedTranscriptPage(canvas, context, pageNumber);
        pageImages.push(canvas.toDataURL("image/jpeg", 0.92));
      }
      reportPhase?.("privacy", "done", "Rendered page identity headers masked before AI");
      reportPhase?.("prepare", "done", `Prepared ${pageImages.length} rendered page${pageImages.length === 1 ? "" : "s"}`);
    } else {
      reportPhase?.("privacy", "done", "Name, student ID, address, email, and phone removed before AI text analysis");
      reportPhase?.("prepare", "done", "Readable transcript text found");
    }
  } finally {
    await pdf.destroy();
  }

  return {
    text,
    pageImages,
    pageCount,
    extractionMode: pageImages.length > 0 ? "rendered-pages" : "text",
  };
}

export function TranscriptImportClient() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { applyTranscriptRecords } = usePlanner();
  const { toast } = useToast();
  const [scriptStatus, setScriptStatus] = useState<ScriptStatus>("loading");
  const [phaseState, setPhaseState] = useState<Phase[]>(initialPhases);
  const [events, setEvents] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<TranscriptCourseRecord[]>([]);
  const [summary, setSummary] = useState<TranscriptImportSummary | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, TranscriptAppliedStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [scriptLoadAttempt, setScriptLoadAttempt] = useState(0);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const markPhase = useCallback((id: PhaseId, status: PhaseStatus, note = "") => {
    setPhaseState((current) =>
      current.map((phase) => (phase.id === id ? { ...phase, status, note } : phase)),
    );
  }, []);

  const addEvent = useCallback((message: string) => {
    setEvents((current) => [...current, message].slice(-6));
  }, []);

  const verifyPuterRuntime = useCallback(async () => {
    const puter = await waitForPuter(3500);
    if (puter) {
      const authState = await getPuterAuthState(puter);
      if (authState === "signed-out") {
        setScriptStatus("auth-required");
        addEvent("Sign in to Puter to use AI analysis. Readable PDFs can still use local detection.");
        return;
      }

      setScriptStatus("ready");
      return;
    }

    setScriptStatus("error");
    addEvent("Puter.js loaded, but the AI runtime was not available. Local fallback will be used when possible.");
  }, [addEvent]);

  const resetRun = useCallback(() => {
    setPhaseState(initialPhases());
    setEvents([]);
    setFileName("");
    setRecords([]);
    setSummary(null);
    setIncluded(new Set());
    setOverrides({});
    setError(null);
    setSaved(false);
    setShowIgnored(false);
  }, []);

  const analyzeWithPuter = useCallback(
    async (extraction: PdfExtraction, reportPhase: PhaseReporter): Promise<TranscriptReconcileResult> => {
      const puter = await waitForPuter();
      let lastError: unknown = null;

      if (puter) {
        const authState = await getPuterAuthState(puter);
        if (authState === "signed-out") {
          setScriptStatus("auth-required");
          addEvent("Puter sign-in is required for AI analysis. Using local detection when the PDF text is readable.");
          lastError = new Error("This transcript needs visual AI analysis. Sign in to Puter, then retry.");
        } else {
          if (authState === "signed-in") setScriptStatus("ready");

          const prompt =
            extraction.pageImages.length > 0
              ? buildTranscriptImagePrompt()
              : buildTranscriptPrompt(extraction.text);
          const preparedImages =
            extraction.pageImages.length > 0
              ? await preparePuterImageInputs({
                  puter,
                  pageImages: extraction.pageImages,
                  addEvent,
                })
              : { imageInputs: [] as string[], cleanup: async () => {} };

          try {
            for (const model of models) {
              try {
                reportPhase("analyze", "running", `Trying ${model.label}`);
                const response = await callPuterChat({
                  puter,
                  prompt,
                  pageImages: preparedImages.imageInputs,
                  model: model.id,
                });
                const payload = extractTranscriptJson(response);
                return reconcileTranscriptCourses({
                  payload,
                  modelUsed: model.id,
                  extractionMode: extraction.extractionMode,
                });
              } catch (candidateError) {
                lastError = candidateError;
                if (model.id === "gpt-5.4-mini") {
                  addEvent("GPT-5.4 mini was unavailable; trying Puter-supported model aliases.");
                }
              }
            }

            addEvent("AI did not return valid course JSON. Using browser parser recovery.");

            if (preparedImages.imageInputs.length > 0 && puter.ai.img2txt) {
              try {
                addEvent("Using OCR fallback on rendered transcript pages.");
                const ocrText = (
                  await Promise.all(
                    preparedImages.imageInputs.map(async (image) =>
                      safeDataUrlForOcr(await callPuterOcr(puter, image)),
                    ),
                  )
                ).join("\n");

                for (const model of models) {
                  try {
                    reportPhase("analyze", "running", `Trying ${model.label} after OCR`);
                    const response = await callPuterChat({
                      puter,
                      prompt: buildTranscriptPrompt(ocrText),
                      pageImages: [],
                      model: model.id,
                    });
                    const payload = extractTranscriptJson(response);
                    return reconcileTranscriptCourses({
                      payload,
                      modelUsed: `${model.id} + OCR`,
                      extractionMode: "rendered-pages",
                    });
                  } catch (candidateError) {
                    lastError = candidateError;
                  }
                }
              } catch (ocrError) {
                lastError = ocrError;
              }
            }
          } finally {
            await preparedImages.cleanup();
          }
        }
      } else {
        addEvent("Puter.js was not available. Using local transcript detection where text is readable.");
      }

      if (!isSparseTranscriptText(extraction.text)) {
        reportPhase("analyze", "running", "Using local parser fallback");
        const payload = buildLocalFallbackPayload(extraction.text);
        return reconcileTranscriptCourses({
          payload,
          modelUsed: "local fallback",
          extractionMode: "local",
        });
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("AI analysis was unavailable and this PDF did not contain readable text.");
    },
    [addEvent],
  );

  const processFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      resetRun();

      if (!isPdf(file)) {
        setError("Upload the PDF file from myUNT. Other file types are not accepted.");
        return;
      }

      if (file.size > maxPdfBytes) {
        setError("This PDF is too large for browser-side transcript import.");
        return;
      }

      setFileName(file.name);
      setIsWorking(true);

      try {
        markPhase("read", "running", file.name);
        const extraction = await extractPdf(file, markPhase);
        markPhase("read", "done", `${extraction.pageCount} page${extraction.pageCount === 1 ? "" : "s"}`);

        markPhase(
          "prepare",
          "done",
          extraction.extractionMode === "rendered-pages"
            ? "Rendered pages for visual analysis"
            : "Readable transcript text found",
        );

        markPhase("analyze", "running", scriptStatus === "ready" ? "Puter.js AI" : "Checking AI runtime");
        const result = await analyzeWithPuter(extraction, markPhase);
        markPhase("analyze", "done", result.summary.modelUsed);

        markPhase("policy", "done", `${result.summary.detected} course row${result.summary.detected === 1 ? "" : "s"}`);
        markPhase("ready", "done", "Review before saving");

        setRecords(result.records);
        setSummary(result.summary);
        setIncluded(
          new Set(
            result.records
              .filter(
                (record) =>
                  !record.reviewRequired &&
                  (record.appliedStatus === "completed" || record.appliedStatus === "inProgress"),
              )
              .map((record) => record.id),
          ),
        );
      } catch (candidateError) {
        markPhase("analyze", "error", "Could not read transcript");
        setError(responseText(candidateError));
      } finally {
        setIsWorking(false);
      }
    },
    [analyzeWithPuter, markPhase, resetRun, scriptStatus],
  );

  const grouped = useMemo(() => {
    const rows = records.map((record) => effectiveRecord(record, overrides[record.id]));
    const willSave = rows.filter(
      (record) =>
        included.has(record.id) &&
        (record.appliedStatus === "completed" || record.appliedStatus === "inProgress"),
    );
    const needsReview = rows.filter(
      (record) =>
        !willSave.some((candidate) => candidate.id === record.id) &&
        record.appliedStatus === "needsReview",
    );
    const ignored = rows.filter(
      (record) =>
        !willSave.some((candidate) => candidate.id === record.id) &&
        !needsReview.some((candidate) => candidate.id === record.id),
    );

    return { willSave, needsReview, ignored };
  }, [included, overrides, records]);

  const runStarted = fileName !== "" || isWorking || summary !== null || error !== null;
  const currentPhase = useMemo(() => {
    const errorPhase = phaseState.find((phase) => phase.status === "error");
    const runningPhase = phaseState.find((phase) => phase.status === "running");
    const lastDone = [...phaseState].reverse().find((phase) => phase.status === "done");
    return errorPhase ?? runningPhase ?? lastDone ?? phaseState[0];
  }, [phaseState]);
  const currentPhaseIndex = Math.max(
    0,
    phaseState.findIndex((phase) => phase.id === currentPhase.id),
  );
  const completedPhaseCount = phaseState.filter((phase) => phase.status === "done").length;
  const auditNotes = useMemo(() => {
    const phaseNotes = phaseState
      .filter((phase) => phase.status !== "pending" && phase.note)
      .map(phaseSummaryText);
    return [...phaseNotes, ...events].slice(-8);
  }, [events, phaseState]);
  const readyToSaveCount = grouped.willSave.length;
  const scriptStatusLabel =
    scriptStatus === "ready"
      ? "AI ready"
      : scriptStatus === "auth-required"
        ? "Sign in for AI"
        : scriptStatus === "error"
          ? "AI unavailable"
          : "Loading AI";

  function retryPuterScript() {
    setScriptStatus("loading");
    addEvent("Retrying Puter.js runtime.");
    setScriptLoadAttempt((attempt) => attempt + 1);
  }

  async function signInToPuter() {
    setError(null);
    setIsSigningIn(true);
    addEvent("Opening Puter sign-in for AI analysis.");

    try {
      const puter = await waitForPuter(3500);
      if (!puter || typeof puter.auth?.signIn !== "function") {
        setScriptStatus("error");
        addEvent("Puter sign-in was unavailable in this browser session.");
        return;
      }

      await withTimeout(puter.auth.signIn(), 30000, "Puter sign-in did not finish in time.");
      const authState = await getPuterAuthState(puter);
      if (authState === "signed-out") {
        setScriptStatus("auth-required");
        addEvent("Puter sign-in was not completed.");
        return;
      }

      setScriptStatus("ready");
      addEvent("Puter AI is ready.");
    } catch (candidateError) {
      setScriptStatus("auth-required");
      setError(responseText(candidateError));
    } finally {
      setIsSigningIn(false);
    }
  }

  function updateIncluded(recordId: string, next: boolean) {
    setIncluded((current) => {
      const updated = new Set(current);
      if (next) {
        updated.add(recordId);
      } else {
        updated.delete(recordId);
      }
      return updated;
    });
  }

  function updateOverride(recordId: string, status: TranscriptAppliedStatus) {
    setOverrides((current) => ({ ...current, [recordId]: status }));
    if (status === "completed" || status === "inProgress") {
      updateIncluded(recordId, true);
    } else {
      updateIncluded(recordId, false);
    }
  }

  function saveDetectedCourses() {
    const selectedRecords = records
      .map((record) => effectiveRecord(record, overrides[record.id]))
      .filter(
        (record) =>
          included.has(record.id) &&
          (record.appliedStatus === "completed" || record.appliedStatus === "inProgress"),
      );

    if (selectedRecords.length === 0) {
      setError("Select at least one completed or in-progress course before saving.");
      return;
    }

    applyTranscriptRecords(selectedRecords);
    setSaved(true);
    toast(`${selectedRecords.length} transcript course${selectedRecords.length === 1 ? "" : "s"} saved`);
  }

  return (
    <NavShell
      step={0}
      back={{ href: "/courses", label: "Courses" }}
      next={{ href: "/schedule", label: "Optimize schedule" }}
    >
      <Script
        key={scriptLoadAttempt}
        src={puterScriptUrl}
        strategy="afterInteractive"
        onLoad={() => {
          void verifyPuterRuntime();
        }}
        onReady={() => {
          void verifyPuterRuntime();
        }}
        onError={() => {
          setScriptStatus("error");
          addEvent("Puter.js script could not load. Allow js.puter.com or continue with local fallback.");
        }}
      />

      <div className="transcript-page">
        <div className="transcript-page__header">
          <div>
            <h1 className="transcript-page__title">Import transcript PDF</h1>
            <p className="transcript-page__copy">
              Upload the unofficial transcript PDF from myUNT. UNTangle reads it in your browser and
              saves only the course evidence you approve. Identity fields are redacted before AI analysis.
            </p>
          </div>
          <Link href="/courses" className="btn-ghost">
            Back to courses
          </Link>
        </div>

        <section
          className="transcript-intake"
          data-active={dragActive ? "true" : "false"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void processFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="transcript-upload__input"
            onChange={(event) => {
              void processFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <div className="transcript-intake__text">
            <h2 className="transcript-section-title">Transcript PDF</h2>
            <p className="transcript-page__copy">
              PDF only, up to 12 MB. Drop it here or choose the file from myUNT.
            </p>
          </div>
          <div className="transcript-intake__action">
            <div className="transcript-intake__meta">
              <span className="transcript-engine-state" data-status={scriptStatus}>
                {scriptStatusLabel}
              </span>
              <span className="transcript-intake__file">{fileName || "No file selected"}</span>
            </div>
            {scriptStatus === "auth-required" ? (
              <Button type="button" variant="ghost" onClick={signInToPuter} disabled={isWorking || isSigningIn}>
                {isSigningIn ? "Signing in" : "Sign in to Puter"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={scriptStatus === "error" ? "ghost" : "secondary"}
              onClick={scriptStatus === "error" ? retryPuterScript : () => inputRef.current?.click()}
              disabled={isWorking || isSigningIn}
            >
              {scriptStatus === "error" ? "Retry AI" : fileName ? "Replace PDF" : "Choose PDF"}
            </Button>
            {scriptStatus === "error" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => inputRef.current?.click()}
                disabled={isWorking || isSigningIn}
              >
                {fileName ? "Replace PDF" : "Choose PDF"}
              </Button>
            ) : null}
          </div>
        </section>

        {runStarted ? (
          <TranscriptAgentStatus
            phases={phaseState}
            activePhase={currentPhase}
            activeIndex={currentPhaseIndex}
            completedCount={completedPhaseCount}
            auditNotes={auditNotes}
            isWorking={isWorking}
            hasError={Boolean(error)}
            isReady={Boolean(summary)}
          />
        ) : null}

        {error ? (
          <div className="transcript-alert" role="alert">
            {error}
          </div>
        ) : null}

        {summary ? (
          <section className="transcript-review">
            <div className="transcript-review__header">
              <div>
                <h2 className="transcript-section-title">Detected courses</h2>
                <p className="transcript-page__copy">
                  Analyzed with {summary.modelUsed} from {extractionText(summary.extractionMode)}.
                </p>
              </div>
              <Button type="button" onClick={saveDetectedCourses} disabled={isWorking || readyToSaveCount === 0}>
                Save {readyToSaveCount} course{readyToSaveCount === 1 ? "" : "s"}
              </Button>
            </div>

            <div className="transcript-review__counts" aria-label="Transcript detection summary">
              <span><strong>{summary.detected}</strong> detected</span>
              <span><strong>{readyToSaveCount}</strong> ready</span>
              <span><strong>{grouped.needsReview.length}</strong> review</span>
              <span><strong>{grouped.ignored.length}</strong> ignored</span>
            </div>

            <TranscriptRecordGroup
              title="Ready to save"
              description="Matched to planner courses and ready to apply."
              rows={grouped.willSave}
              included={included}
              overrides={overrides}
              onIncluded={updateIncluded}
              onOverride={updateOverride}
            />
            <TranscriptRecordGroup
              title="Needs review"
              description="Parsed from the transcript, but needs a decision first."
              rows={grouped.needsReview}
              included={included}
              overrides={overrides}
              onIncluded={updateIncluded}
              onOverride={updateOverride}
            />
            {grouped.ignored.length > 0 ? (
              <div className="transcript-ignored">
                <button
                  type="button"
                  className="btn-ghost transcript-ignored__toggle"
                  onClick={() => setShowIgnored((current) => !current)}
                >
                  {showIgnored ? "Hide ignored courses" : `Show ${grouped.ignored.length} ignored courses`}
                </button>
                {showIgnored ? (
                  <TranscriptRecordGroup
                    title="Ignored"
                    description="Duplicate, excluded, or no-credit rows."
                    rows={grouped.ignored}
                    included={included}
                    overrides={overrides}
                    onIncluded={updateIncluded}
                    onOverride={updateOverride}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {saved ? (
          <section className="transcript-complete">
            <p>Transcript courses were saved to your planner.</p>
            <div>
              <Link href="/courses" className="btn-secondary">
                Review courses
              </Link>
              <Link href="/schedule" className="btn-primary">
                Continue to schedule
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </NavShell>
  );
}

function TranscriptAgentStatus({
  phases: phaseRows,
  activePhase,
  activeIndex,
  completedCount,
  auditNotes,
  isWorking,
  hasError,
  isReady,
}: {
  phases: Phase[];
  activePhase: Phase;
  activeIndex: number;
  completedCount: number;
  auditNotes: string[];
  isWorking: boolean;
  hasError: boolean;
  isReady: boolean;
}) {
  const state = hasError ? "error" : isReady ? "ready" : isWorking ? "working" : "idle";
  const title = hasError
    ? "Could not finish import"
    : isReady
      ? "Ready to review"
      : "UNTangle is analyzing your transcript";
  const detail = hasError
    ? "The import stopped before courses could be saved."
    : isReady
      ? "Review the detected rows below, then save the courses that look right."
      : activePhase.note || "Working through the PDF and catalog checks.";
  const progressValue = Math.min(phaseRows.length, completedCount + (isWorking && !isReady ? 0.35 : 0));

  return (
    <section className="transcript-agent" data-state={state} aria-live="polite" aria-busy={isWorking}>
      <div className="transcript-agent__header">
        <ThinkingIcon active={isWorking && !hasError && !isReady} />
        <div className="transcript-agent__heading">
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
        <span className="transcript-agent__step">
          {isReady ? "Done" : hasError ? "Stopped" : `Step ${activeIndex + 1} of ${phaseRows.length}`}
        </span>
      </div>

      <progress
        className="transcript-agent__progress"
        max={phaseRows.length}
        value={progressValue}
        aria-label="Transcript import progress"
      />

      <ol className="transcript-step-list">
        {phaseRows.map((phase, index) => {
          const distance = Math.abs(index - activeIndex);
          const opacity =
            phase.status === "pending"
              ? Math.max(0.38, 0.72 - distance * 0.12)
              : Math.max(0.62, 1 - distance * 0.1);

          return (
            <li
              key={phase.id}
              className="transcript-step"
              data-state={phase.status}
              style={{ "--step-index": index, "--step-opacity": opacity } as CSSProperties}
            >
              <StepIcon status={phase.status} />
              <div>
                <div className="transcript-step__row">
                  <strong>{phase.label}</strong>
                  <span>{phaseStatusLabel(phase.status)}</span>
                </div>
                {phase.status !== "pending" && phase.note ? <p>{phase.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="transcript-agent-notes">
        <div className="transcript-agent-notes__title">Analysis notes</div>
        {auditNotes.length > 0 ? (
          <ul>
            {auditNotes.map((note, index) => (
              <li key={`${note}-${index}`} style={{ "--note-index": index } as CSSProperties}>
                {note}
              </li>
            ))}
          </ul>
        ) : (
          <p>Waiting for the first transcript update.</p>
        )}
      </div>
    </section>
  );
}

function TranscriptRecordGroup({
  title,
  description,
  rows,
  included,
  overrides,
  onIncluded,
  onOverride,
}: {
  title: string;
  description?: string;
  rows: TranscriptCourseRecord[];
  included: Set<string>;
  overrides: Record<string, TranscriptAppliedStatus>;
  onIncluded: (recordId: string, next: boolean) => void;
  onOverride: (recordId: string, status: TranscriptAppliedStatus) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="transcript-record-group">
      <div className="transcript-record-group__header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <span>{rows.length}</span>
      </div>
      <div className="transcript-record-list" role="list" aria-label={`${title} transcript courses`}>
        {rows.map((record) => {
          const currentStatus = overrides[record.id] ?? record.appliedStatus;
          const canSave = currentStatus === "completed" || currentStatus === "inProgress";
          const note = recordDecisionNote(record, currentStatus);
          return (
            <article key={record.id} className="transcript-record-row" data-status={currentStatus} role="listitem">
              <label className="transcript-record-row__check">
                <input
                  type="checkbox"
                  checked={included.has(record.id)}
                  disabled={!canSave}
                  onChange={(event) => onIncluded(record.id, event.currentTarget.checked)}
                />
                <span className="sr-only">Save {record.code}</span>
              </label>

              <div className="transcript-record-row__main">
                <div className="transcript-record-row__course">
                  <strong>{record.code}</strong>
                  <span>{record.title}</span>
                </div>
              </div>

              <div className="transcript-record-row__meta">
                <span>{record.term || "Term unknown"}</span>
                <strong>{record.grade || "-"}</strong>
                {note ? <em>{note}</em> : null}
              </div>

              <div className="transcript-record-row__action">
                <select
                  className="transcript-status-select"
                  value={currentStatus}
                  onChange={(event) =>
                    onOverride(record.id, event.currentTarget.value as TranscriptAppliedStatus)
                  }
                  aria-label={`Action for ${record.code}; currently ${statusText(currentStatus)}`}
                >
                  <option value="completed">Done</option>
                  <option value="inProgress">Taking</option>
                  <option value="needsReview">Review</option>
                  <option value="ignored">Ignore</option>
                </select>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
