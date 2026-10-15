import {
  buildLocalFallbackPayload,
  reconcileTranscriptCourses,
  redactTranscriptText,
} from "../transcript-import";

export const MAX_PDF_BYTES = 12 * 1024 * 1024;

/** The transcript PDF the student chose, or its text (what the tests feed in). */
export type TranscriptInput = File | { kind: "transcript-text"; text: string };

/**
 * Why a file can't be imported, for the screen that says so:
 * - `notext`: the PDF has no text layer (a scan or a photo);
 * - `wrongfile`: it has text, but it is another myUNT document, such as a degree audit;
 * - `unreadable`: anything else (too big, not a PDF, no course rows), with the reason in `message`.
 */
export type ImportProblemKind = "notext" | "wrongfile" | "unreadable";

export class ImportProblem extends Error {
  constructor(
    readonly kind: ImportProblemKind,
    message: string,
    /** For `wrongfile`: the document it looks like, when the text names it. */
    readonly document: "degree audit" | null = null,
  ) {
    super(message);
    this.name = "ImportProblem";
  }
}

/** Reading the PDF's text, then finding and matching course rows. */
export type ParseStage = "read" | "match";

/**
 * Words that name a myUNT degree audit (PeopleSoft's "Academic Advisement
 * Report" and its what-if variant). Starting values: no real UNT audit PDF
 * has been checked against them.
 */
const AUDIT_MARKERS = /\b(degree audit|advisement report|what-if report)\b/i;
/** A transcript's own heading. Also a starting value with no real-PDF check behind it. */
const TRANSCRIPT_MARKERS = /\btranscript\b/i;

/**
 * What the text alone says about the document, before any course matching:
 * an audit that never calls itself a transcript is refused, because the
 * fallback parser would otherwise read every course code on it as a row.
 */
export function classifyTranscriptText(text: string): ImportProblem | null {
  if (!/[a-z]{3}/i.test(text)) {
    return new ImportProblem("notext", "This PDF has no readable text.");
  }
  if (AUDIT_MARKERS.test(text) && !TRANSCRIPT_MARKERS.test(text)) {
    return new ImportProblem("wrongfile", "That PDF is a degree audit.", "degree audit");
  }
  return null;
}

/**
 * Reads an unofficial transcript in the browser: PDF text via pdf.js,
 * labeled identity fields redacted, then rows matched to the catalog.
 * Nothing is uploaded. Failures are ImportProblems; an abort rejects with
 * the signal's AbortError.
 */
export async function parseConnectTranscript(
  input: TranscriptInput,
  signal: AbortSignal,
  onStage: (stage: ParseStage) => void = () => {},
) {
  try {
    return await readTranscript(input, signal, onStage);
  } catch (error) {
    // A broken or locked PDF fails inside pdf.js with its own error; say it in the page's words.
    if (error instanceof ImportProblem || signal.aborted) throw error;
    throw new ImportProblem("unreadable", "This PDF couldn't be opened. Download the transcript from myUNT again and choose the new file.");
  }
}

async function readTranscript(input: TranscriptInput, signal: AbortSignal, onStage: (stage: ParseStage) => void) {
  signal.throwIfAborted();
  onStage("read");
  let text: string;
  if (!(input instanceof File)) text = input.text;
  else {
    if (input.size > MAX_PDF_BYTES) throw new ImportProblem("unreadable", "Choose a transcript PDF under 12 MB.");
    const data = new Uint8Array(await input.arrayBuffer());
    if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-")
      throw new ImportProblem("unreadable", "That file isn't a PDF. Choose the PDF you saved from myUNT.");
    signal.throwIfAborted();
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ data });
    const abort = () => {
      void task.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    task.onPassword = () => {
      void task.destroy();
    };
    try {
      signal.throwIfAborted();
      const pdf = await task.promise;
      // Bounds browser work for malformed PDFs. No real transcript page-count measurements exist yet.
      if (pdf.numPages > 100)
        throw new ImportProblem("unreadable", "This PDF has more than 100 pages. Use a shorter unofficial transcript.");
      const pages: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      }
      text = pages.join("\n");
    } finally {
      signal.removeEventListener("abort", abort);
      await task.destroy();
    }
  }
  signal.throwIfAborted();
  const problem = classifyTranscriptText(text);
  if (problem) throw problem;
  onStage("match");
  const result = reconcileTranscriptCourses({
    payload: buildLocalFallbackPayload(redactTranscriptText(text)),
    modelUsed: "browser parser",
    extractionMode: "local",
  });
  if (!result.records.length)
    throw new ImportProblem(
      "unreadable",
      "No course rows were found in that PDF. In myUNT, open Academic Records, then Unofficial Transcript, and download it with View as PDF.",
    );
  return result;
}
