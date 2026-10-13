import {
  MAX_PDF_BYTES,
  MAX_TEXT_LENGTH,
  type Payload,
  type SectionRow,
} from "../../frontend/src/lib/connect/protocol";
import { allowedPdfUrl, pageKind } from "./config";
export class ReportError extends Error {
  constructor(
    public reason:
      "DOWNLOAD_FAILED" | "UNSUPPORTED_REPORT" | "INVALID_PDF" | "TOO_LARGE",
  ) {
    super(reason);
  }
}
export function visible(element: Element): boolean {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}
export function extractSections(doc: Document): SectionRow[] {
  const keys = [
    "course",
    "section",
    "days",
    "times",
    "room",
    "instructor",
    "status",
  ] as const;
  const rows: SectionRow[] = [];
  for (const table of doc.querySelectorAll("table")) {
    const headers = [...table.querySelectorAll("tr")].find((tr) =>
      tr.querySelector("th"),
    );
    if (!headers) continue;
    const labels = [...headers.querySelectorAll("th,td")].map(
      (el) =>
        (el instanceof HTMLElement && visible(el) ? el.innerText : "")
          .trim()
          .toLowerCase() ?? "",
    );
    const indexes = keys.map((key) =>
      labels.findIndex(
        (label) =>
          label === key ||
          (key === "course" && label === "class") ||
          (key === "times" && label === "time"),
      ),
    );
    if (indexes.includes(-1)) continue;
    for (const tr of table.querySelectorAll("tr")) {
      if (tr === headers || !visible(tr)) continue;
      const cells = [...tr.querySelectorAll("td")];
      if (cells.length < labels.length) continue;
      const cell = (i: number) => {
        const element = cells[indexes[i]];
        return visible(element) ? element.innerText.trim().slice(0, 500) : "";
      };
      const row: SectionRow = {
        course: cell(0),
        section: cell(1),
        days: cell(2),
        times: cell(3),
        room: cell(4),
        instructor: cell(5),
        status: cell(6),
      };
      if (/^[A-Z]{2,5}\s*\d{4}$/.test(row.course) && row.section)
        rows.push(row);
    }
  }
  return rows.slice(0, 1000);
}
function reportPdfUrls(doc: Document, pageUrl: string, dev: boolean): string[] {
  const urls = new Set<string>();
  for (const el of doc.querySelectorAll(
    "a[href],iframe[src],embed[src],object[data]",
  )) {
    if (!visible(el)) continue;
    const raw =
      el.getAttribute("href") ??
      el.getAttribute("src") ??
      el.getAttribute("data") ??
      "";
    const pdf =
      /\.pdf(?:$|[?#])/i.test(raw) ||
      el.getAttribute("type") === "application/pdf" ||
      /view report|download|save pdf/i.test(el.textContent ?? "");
    if (!pdf || !allowedPdfUrl(raw, pageUrl, dev)) continue;
    try {
      urls.add(new URL(raw, pageUrl).href);
    } catch {
      continue;
    }
  }
  return [...urls];
}
export function reportReady(
  doc: Document,
  pageUrl: string,
  dev: boolean,
): boolean {
  if (
    pageKind(pageUrl, dev) !== "transcript" ||
    !/unofficial\s+transcript/i.test(doc.body.innerText)
  )
    return false;
  return (
    reportPdfUrls(doc, pageUrl, dev).length > 0 ||
    [
      ...doc.querySelectorAll("[data-transcript-report], #transcript-report"),
    ].some(
      (el) => visible(el) && /[A-Z]{2,5}\s+\d{4}/.test(el.textContent ?? ""),
    )
  );
}
export async function readReport(
  doc: Document,
  pageUrl: string,
  dev: boolean,
  signal: AbortSignal,
): Promise<Payload> {
  if (
    pageKind(pageUrl, dev) !== "transcript" ||
    !/unofficial\s+transcript/i.test(doc.body.innerText)
  )
    throw new ReportError("UNSUPPORTED_REPORT");
  const urls = reportPdfUrls(doc, pageUrl, dev);
  if (urls.length > 1) throw new ReportError("UNSUPPORTED_REPORT");
  if (urls[0]) {
    let result: Response;
    try {
      // The browser attaches its existing session. The extension never accesses cookies or credentials.
      result = await fetch(urls[0], {
        credentials: "same-origin",
        redirect: "error",
        signal,
      });
    } catch {
      throw new ReportError("DOWNLOAD_FAILED");
    }
    if (!result.ok) throw new ReportError("DOWNLOAD_FAILED");
    if (Number(result.headers.get("content-length")) > MAX_PDF_BYTES)
      throw new ReportError("TOO_LARGE");
    if (!result.body) throw new ReportError("DOWNLOAD_FAILED");
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_PDF_BYTES) throw new ReportError("TOO_LARGE");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-")
      throw new ReportError("INVALID_PDF");
    let binary = "";
    for (let i = 0; i < data.length; i += 8192)
      binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return { kind: "pdf", base64: btoa(binary) };
  }
  const report = [
    ...doc.querySelectorAll("[data-transcript-report], #transcript-report"),
  ].find(visible);
  const text = report instanceof HTMLElement ? report.innerText : "";
  if (!text || !/[A-Z]{2,5}\s+\d{4}/.test(text))
    throw new ReportError("UNSUPPORTED_REPORT");
  if (text.length > MAX_TEXT_LENGTH) throw new ReportError("TOO_LARGE");
  return { kind: "transcript-text", text };
}
