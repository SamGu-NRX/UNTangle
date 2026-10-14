/**
 * Turn a downloaded syllabus (PDF or HTML) into plain text for the fact
 * extractor.
 *
 * PDFs go through the `pdfjs-dist` copy the frontend already ships (resolved
 * by path so the tools directory adds no dependency of its own). Line breaks
 * reported by pdf.js (`hasEOL`) are preserved as newlines: sentence offsets
 * in the study refer to this exact reconstruction.
 */

import path from "node:path";

// frontend/node_modules is the only copy of pdfjs-dist in the monorepo.
const PDFJS_PATH = path.join(import.meta.dir, "../../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs");

export interface SyllabusText {
  text: string;
  kind: "pdf" | "html" | "text";
  pages: number | null;
}

async function pdfToText(body: Buffer): Promise<SyllabusText> {
  const { getDocument } = (await import(PDFJS_PATH)) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: true, isEvalSupported: false }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    text += "\n";
  }
  return { text, kind: "pdf", pages: doc.numPages };
}

function htmlToText(body: Buffer): SyllabusText {
  const html = body.toString("utf8");
  const withoutNoise = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n");
  const text = withoutNoise
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n");
  return { text: text.trim(), kind: "html", pages: null };
}

export async function extractSyllabusText(body: Buffer, contentType: string): Promise<SyllabusText> {
  const isPdf = contentType.includes("application/pdf") || (body.length > 4 && body.subarray(0, 4).toString() === "%PDF");
  if (isPdf) {
    try {
      return await pdfToText(body);
    } catch (err) {
      // A damaged or scanned PDF yields no text layer; report that honestly
      // instead of falling back to something that would look like text.
      throw new Error(`pdf text extraction failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (contentType.includes("html") || /^\s*</.test(body.toString("utf8", 0, 64))) return htmlToText(body);
  return { text: body.toString("utf8"), kind: "text", pages: null };
}
