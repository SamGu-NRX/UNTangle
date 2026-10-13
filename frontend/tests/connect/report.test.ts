import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readReport, ReportError } from "../../../extension/src/read-report";
import { syntheticPdf } from "../../../tools/mock-myunt/pdf";
const nativeFetch = globalThis.fetch;
const nativeComputed = globalThis.getComputedStyle;
const nativeHTMLElement = globalThis.HTMLElement;
afterEach(() => { globalThis.fetch = nativeFetch; globalThis.getComputedStyle = nativeComputed; globalThis.HTMLElement = nativeHTMLElement; });
function doc(body: string) {
  const window = new Window({ url: "http://localhost:4317/transcript-report" });
  window.document.body.innerHTML = `<h1>Unofficial Transcript</h1>${body}`;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window) as typeof getComputedStyle;
  globalThis.HTMLElement = window.HTMLElement as typeof HTMLElement;
  for (const el of window.document.querySelectorAll("*")) el.getClientRects = () => [{ width: 20, height: 20 }] as unknown as DOMRectList;
  return window.document as unknown as Document;
}
test("fetches only the page's own PDF with its same-origin session", async () => {
  let options: RequestInit | undefined;
  globalThis.fetch = (async (url, opts) => { expect(String(url)).toBe("http://localhost:4317/synthetic-transcript.pdf"); options = opts; return new Response(syntheticPdf()); }) as typeof fetch;
  const result = await readReport(doc('<a href="/synthetic-transcript.pdf">View Report</a>'), "http://localhost:4317/transcript-report", true, new AbortController().signal);
  expect(result.kind).toBe("pdf"); expect(options?.credentials).toBe("same-origin"); expect(options?.redirect).toBe("error");
});
test("rejects HTML login responses and oversize downloads", async () => {
  const report = doc('<a href="/synthetic-transcript.pdf">View Report</a>');
  globalThis.fetch = (async () => new Response("<html>Sign in</html>")) as typeof fetch;
  await expect(readReport(report, "http://localhost:4317/transcript-report", true, new AbortController().signal)).rejects.toMatchObject({ reason: "INVALID_PDF" });
  globalThis.fetch = (async () => new Response("x", { headers: { "content-length": String(13 * 1024 * 1024) } })) as typeof fetch;
  await expect(readReport(report, "http://localhost:4317/transcript-report", true, new AbortController().signal)).rejects.toMatchObject({ reason: "TOO_LARGE" });
});
test("does not fetch cross-origin links or guess an unsupported report", async () => {
  globalThis.fetch = (async () => { throw new Error("Must not fetch"); }) as typeof fetch;
  await expect(readReport(doc('<a href="https://evil.example/report.pdf">View Report</a>'), "http://localhost:4317/transcript-report", true, new AbortController().signal)).rejects.toBeInstanceOf(ReportError);
});
test("extracts the explicit rendered report without the page's other text", async () => {
  const result = await readReport(doc('<p>Private unrelated page content</p><pre id="transcript-report">2025 Fall\nCSCE 1030 Computer Science I 3.000 3.000 A 12.000</pre>'), "http://localhost:4317/transcript-report", true, new AbortController().signal);
  expect(result).toMatchObject({ kind: "transcript-text" });
  if (result.kind === "transcript-text") expect(result.text).not.toContain("Private unrelated");
});
