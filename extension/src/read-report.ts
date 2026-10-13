import { MAX_PDF_BYTES, MAX_TEXT_LENGTH, type Payload, type SectionRow } from "../../frontend/src/lib/connect/protocol";
import { allowedPdfUrl } from "./config";
export class ReportError extends Error {
  constructor(public reason: "DOWNLOAD_FAILED" | "UNSUPPORTED_REPORT" | "INVALID_PDF" | "TOO_LARGE") { super(reason); }
}
export function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}
export function extractSections(doc: Document): SectionRow[] {
  const keys = ["course", "section", "days", "times", "room", "instructor", "status"] as const;
  const rows: SectionRow[] = [];
  for (const table of doc.querySelectorAll("table")) {
    const headers = [...table.querySelectorAll("tr")].find(tr => tr.querySelector("th"));
    if (!headers) continue;
    const labels = [...headers.querySelectorAll("th,td")].map(el => el.textContent?.trim().toLowerCase() ?? "");
    const indexes = keys.map(key => labels.findIndex(label => label === key || (key === "course" && label === "class") || (key === "times" && label === "time")));
    if (indexes.includes(-1)) continue;
    for (const tr of table.querySelectorAll("tr")) {
      if (tr === headers || !visible(tr)) continue;
      const cells = [...tr.querySelectorAll("td")];
      if (cells.length < labels.length) continue;
      const row = Object.fromEntries(keys.map((key, i) => [key, cells[indexes[i]].textContent?.trim().slice(0, 500) ?? ""])) as SectionRow;
      if (/^[A-Z]{2,5}\s*\d{4}$/.test(row.course) && row.section) rows.push(row);
    }
  }
  return rows.slice(0, 1000);
}
export async function readReport(doc: Document, pageUrl: string, dev: boolean, signal: AbortSignal): Promise<Payload> {
  if (!/unofficial\s+transcript/i.test(doc.body.innerText)) throw new ReportError("UNSUPPORTED_REPORT");
  const candidates = [...doc.querySelectorAll("a[href],iframe[src],embed[src],object[data]")].filter(visible).map(el => {
    const raw = el.getAttribute("href") ?? el.getAttribute("src") ?? el.getAttribute("data") ?? "";
    return { url: new URL(raw, pageUrl).href, pdf: /\.pdf(?:$|[?#])/i.test(raw) || el.getAttribute("type") === "application/pdf" || /view report|download|save pdf/i.test(el.textContent ?? "") };
  }).filter(c => c.pdf && allowedPdfUrl(c.url, pageUrl, dev));
  const urls = [...new Set(candidates.map(c => c.url))];
  if (urls.length > 1) throw new ReportError("UNSUPPORTED_REPORT");
  if (urls[0]) {
    let result: Response;
    try {
      // The browser attaches its existing session. The extension never accesses cookies or credentials.
      result = await fetch(urls[0], { credentials: "same-origin", redirect: "error", signal });
    } catch { throw new ReportError("DOWNLOAD_FAILED"); }
    if (!result.ok) throw new ReportError("DOWNLOAD_FAILED");
    if (Number(result.headers.get("content-length")) > MAX_PDF_BYTES) throw new ReportError("TOO_LARGE");
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
    } finally { await reader.cancel(); }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") throw new ReportError("INVALID_PDF");
    let binary = "";
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return { kind: "pdf", base64: btoa(binary) };
  }
  const report = [...doc.querySelectorAll("[data-transcript-report], #transcript-report")].find(visible);
  const text = report instanceof HTMLElement ? report.innerText : "";
  if (!text || !/[A-Z]{2,5}\s+\d{4}/.test(text)) throw new ReportError("UNSUPPORTED_REPORT");
  if (text.length > MAX_TEXT_LENGTH) throw new ReportError("TOO_LARGE");
  return { kind: "transcript-text", text };
}
