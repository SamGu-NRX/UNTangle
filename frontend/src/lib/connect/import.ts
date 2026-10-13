import {
  buildLocalFallbackPayload,
  reconcileTranscriptCourses,
  redactTranscriptText,
} from "../transcript-import";
import { MAX_PDF_BYTES, type Payload } from "./protocol";
export async function parseConnectTranscript(
  input: File | Payload,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let text: string;
  if (!(input instanceof File) && input.kind === "transcript-text")
    text = input.text;
  else {
    let data: Uint8Array;
    if (input instanceof File) {
      if (input.size > MAX_PDF_BYTES)
        throw new Error("Choose a transcript PDF under 12 MB.");
      data = new Uint8Array(await input.arrayBuffer());
    } else {
      if (input.kind !== "pdf")
        throw new Error(
          "Expected a transcript report, received class search results.",
        );
      const binary = atob(input.base64);
      if (binary.length > MAX_PDF_BYTES)
        throw new Error("Choose a transcript PDF under 12 MB.");
      data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }
    if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-")
      throw new Error("Choose the PDF you saved from myUNT.");
    signal.throwIfAborted();
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
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
        throw new Error(
          "This PDF has more than 100 pages. Use a shorter unofficial transcript.",
        );
      const pages: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" "),
        );
      }
      text = pages.join("\n");
    } finally {
      signal.removeEventListener("abort", abort);
      await task.destroy();
    }
  }
  signal.throwIfAborted();
  const result = reconcileTranscriptCourses({
    payload: buildLocalFallbackPayload(redactTranscriptText(text)),
    modelUsed: "browser parser",
    extractionMode: "local",
  });
  if (!result.records.length)
    throw new Error(
      // Only text PDFs are read; there is no scanned-PDF importer to send people to.
      "No readable course rows were found. In myUNT, use View as PDF and upload that file; a scan or photo of the transcript can't be read.",
    );
  return result;
}
