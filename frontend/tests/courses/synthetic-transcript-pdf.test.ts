/**
 * Synthetic transcript-PDF exercise (M4).
 *
 * The transcript import pipeline below the Puter.js script tag is:
 *   PDF bytes -> pdfjs text extraction -> local fallback payload -> reconcile.
 *
 * These tests exercise that chain end-to-end against hand-rolled PDF bytes
 * (valid xref, real text operators — no binary fixtures, no network):
 *
 * 1. A multi-page synthetic transcript PDF is readable by the installed
 *    pdfjs-dist (legacy build of the same package the app imports) and
 *    yields page text through the same item-join `extractPdf` uses.
 * 2. The local fallback parser reads UNT transcript table rows from that
 *    text (codes, titles, terms, grades, credit hours).
 * 3. `reconcileTranscriptCourses` classifies known codes as completed /
 *    in-progress and flags unknown codes for review instead of fabricating
 *    catalog entries.
 * 4. Sparse text (no readable course codes) routes to rendered-page
 *    analysis rather than local parsing.
 * 5. Corrupt PDF bytes fail loudly at extraction — the component surfaces
 *    the error rather than silently continuing.
 *
 * Mounting TranscriptImportClient itself is deliberately avoided: it renders
 * an unconditional next/script tag for js.puter.com, which offline tests
 * must never load (same doctrine as tests/transcript-confirm.test.ts). All
 * rows are synthetic; no real transcript data is used.
 */
import { describe, expect, test } from "bun:test";
import {
  buildLocalFallbackPayload,
  isSparseTranscriptText,
  reconcileTranscriptCourses,
} from "@/lib/transcript-import";

// --- hand-rolled multi-page PDF builder (PDF 1.4, ASCII only) -------------

function pdfEscape(line: string) {
  return line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Build a valid multi-page PDF whose pages contain the given text lines. */
export function buildMultiPagePdf(pages: string[][]): Uint8Array {
  const objects: string[] = []; // index = object number, 0 unused
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const contentNum = 4 + 2 * i;
    const pageNum = 5 + 2 * i;
    const stream = [
      "BT",
      "/F1 10 Tf",
      "40 750 Td",
      "14 TL",
      lines
        .map((line, li) => `(${pdfEscape(line)}) Tj${li < lines.length - 1 ? "\nT*" : ""}`)
        .join("\n"),
      "ET",
    ].join("\n");
    objects[contentNum] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(out); // ASCII-only -> char offsets == byte offsets
}

// --- pdfjs extraction, mirroring extractPdf's per-page item join ----------
// (frontend/src/components/transcript-import-client.tsx, web build of the
// same pdfjs-dist package; the legacy build runs without a worker here)

type ExtractedItem = { str?: string };
type PdfPage = { getTextContent: () => Promise<{ items: ExtractedItem[] }> };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJsModule = {
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
};

async function importPdfJs(): Promise<PdfJsModule> {
  return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await importPdfJs();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  let text = "";
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => (item && typeof item === "object" && "str" in item ? String(item.str ?? "") : ""))
        .join(" ");
      text += `${pageText}\n`;
    }
  } finally {
    await pdf.destroy();
  }
  return text;
}

// --- synthetic transcript content (fake student, real catalog codes) ------

const page1 = [
  "University of North Texas",
  "Official Academic Transcript",
  "Student: Sample Student",
  "Student ID: 999999999",
  "Degree: BS Computer Science",
  "Advisor: Sample Advisor",
  "Academic Level: Undergraduate",
  "Enrollment Status: Full Time",
  "Credential: Bachelors Degree",
  "Academic Plan: Computer Science BS",
  "Campus: Denton",
  "Application Status: Active",
  "Total Hours Earned toward Highest Degree 7.000",
  "Total GPA Hours: 7.000",
  "Cumulative GPA: 3.285",
  "Official as of 10/11/2026",
];

// Real bundled-catalog codes; UNT transcript table row shape:
// CODE Title attempted earned [grade] points
const page2 = [
  "2023 Fall",
  "CSCE 1030 Computer Science I 3.000 3.000 A 12.000",
  "MATH 1650 Calculus I 4.000 4.000 B 11.996",
];

const page3 = [
  "2024 Spring",
  "CSCE 2110 Computer Science II 3.000 0.000 EN 0.000",
  "CSCE 9999 Unknown Future Course 3.000 3.000 C 6.000",
];

const transcriptPages = [page1, page2, page3];

describe("synthetic transcript PDF import (M4)", () => {
  test("multi-page synthetic PDF is readable by the installed pdfjs-dist", async () => {
    const bytes = buildMultiPagePdf(transcriptPages);
    expect(bytes.byteLength).toBeGreaterThan(1200);
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("%PDF-1.4");

    const text = await extractPdfText(bytes);
    expect(text).toContain("Official Academic Transcript");
    expect(text).toContain("CSCE 1030 Computer Science I");
    expect(text).toContain("MATH 1650 Calculus I");
    expect(text).toContain("CSCE 9999 Unknown Future Course");
    // multi-page order preserved: page 2 content precedes page 3 content
    expect(text.indexOf("MATH 1650")).toBeLessThan(text.indexOf("CSCE 9999"));
  });

  test("local fallback parser reads UNT table rows from the extracted text", async () => {
    const text = await extractPdfText(buildMultiPagePdf(transcriptPages));
    const payload = buildLocalFallbackPayload(text);

    const codes = payload.records.map((r) => r.code).sort();
    expect(codes).toEqual(["CSCE 1030", "CSCE 2110", "CSCE 9999", "MATH 1650"]);

    const row1030 = payload.records.find((r) => r.code === "CSCE 1030");
    expect(row1030?.title).toBe("Computer Science I");
    expect(row1030?.grade).toBe("A");
    expect(row1030?.term).toBe("2023 Fall");
    expect(row1030?.credits).toBe(3);

    const row2110 = payload.records.find((r) => r.code === "CSCE 2110");
    expect(row2110?.grade).toBe("EN");
  });

  test("reconcile classifies known codes and flags unknown codes for review", async () => {
    const text = await extractPdfText(buildMultiPagePdf(transcriptPages));
    const payload = buildLocalFallbackPayload(text);
    const result = reconcileTranscriptCourses({
      payload,
      modelUsed: "local fallback",
      extractionMode: "local",
    });

    expect(result.summary.detected).toBe(4);
    const byCode = new Map(result.records.map((r) => [r.code, r]));
    expect(byCode.get("CSCE 1030")?.appliedStatus).toBe("completed");
    expect(byCode.get("MATH 1650")?.appliedStatus).toBe("completed");
    expect(byCode.get("CSCE 2110")?.appliedStatus).toBe("inProgress");

    // Unknown code: explicitly routed to review, never fabricated into a course
    const unknownRow = byCode.get("CSCE 9999");
    expect(unknownRow).toBeDefined();
    expect(unknownRow?.reviewRequired).toBe(true);
    expect(unknownRow?.appliedStatus).not.toBe("completed");
    expect(unknownRow?.appliedStatus).not.toBe("inProgress");
  });

  test("sparse text without readable course codes routes to rendered-page analysis", async () => {
    // Long enough to pass the 600-char length floor, but zero course-code
    // matches: the code-count condition is what triggers the sparse route.
    const headerOnly = "University of North Texas Official Academic Transcript ".repeat(40);
    expect(headerOnly.length).toBeGreaterThanOrEqual(600);
    expect(isSparseTranscriptText(headerOnly)).toBe(true);

    // The full synthetic transcript crosses both thresholds: rich text layer
    // AND enough readable codes, so the local parser must be used.
    const fullText = await extractPdfText(buildMultiPagePdf(transcriptPages));
    expect(fullText.length).toBeGreaterThanOrEqual(600);
    expect(isSparseTranscriptText(fullText)).toBe(false);
  });

  test("corrupt PDF bytes fail loudly at extraction", async () => {
    const pdfjs = await importPdfJs();

    const garbage = new TextEncoder().encode("this file is definitely not a pdf document at all");
    let rejectedGarbage = false;
    try {
      await pdfjs.getDocument({ data: garbage }).promise;
    } catch (error) {
      rejectedGarbage = true;
      expect(String(error)).toMatch(/pdf/i);
    }
    expect(rejectedGarbage).toBe(true);

    const headerOnly = new TextEncoder().encode("%PDF-1.4\n");
    let rejectedHeaderOnly = false;
    try {
      await pdfjs.getDocument({ data: headerOnly }).promise;
    } catch {
      rejectedHeaderOnly = true;
    }
    expect(rejectedHeaderOnly).toBe(true);
  });
});
