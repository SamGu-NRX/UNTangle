/**
 * The SSRF-hardened feed fetcher. Every hop of a redirect chain is validated
 * and DNS-resolved before it is fetched; resolution failures fail closed. The
 * whole chain shares one deadline, and the body is capped whether or not the
 * server tells the truth about its size.
 */

import { CalendarFetchError } from "./errors";
import { ipLiteralHost, isBlockedAddress, validateCalendarUrl } from "./ssrf";

export type DnsEntry = { address: string; family: 4 | 6 };

/** Everything a test needs to replace in order to keep fetchCalendarIcs off the network. */
export type FetchDeps = {
  resolveDns: (hostname: string) => Promise<DnsEntry[]>;
  doFetch: (url: string, init: { redirect: "manual"; signal: AbortSignal }) => Promise<Response>;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
};

/** The largest feed body accepted, in bytes: 1 MiB. */
export const CALENDAR_MAX_BYTES = 1024 * 1024;

export const defaultFetchDeps: FetchDeps = {
  resolveDns: async (hostname) => {
    // Imported at call time on purpose: tests can mock.module the dns module
    // and the route (which uses these defaults) picks the mock up per call.
    const dns = await import("node:dns/promises");
    const entries = await dns.lookup(hostname, { all: true, verbatim: true });
    return entries.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
  },
  doFetch: (url, init) => globalThis.fetch(url, init),
  timeoutMs: 10_000,
  maxBytes: CALENDAR_MAX_BYTES,
  maxRedirects: 3,
};

/**
 * Fetches an iCalendar feed and returns the raw text. Throws CalendarFetchError
 * with a kind of "blocked" or "invalid" when the URL or response is unusable
 * (the preview route answers 400), and "unreachable" or "timeout" when the
 * network side failed (the route answers 502).
 */
export async function fetchCalendarIcs(rawUrl: string, deps: Partial<FetchDeps> = {}): Promise<string> {
  const resolved: FetchDeps = { ...defaultFetchDeps, ...deps };
  const signal = AbortSignal.timeout(resolved.timeoutMs);
  const deadline = Date.now() + resolved.timeoutMs;
  let currentUrl = rawUrl;
  for (let hop = 0; ; hop += 1) {
    const check = validateCalendarUrl(currentUrl);
    if (!check.ok) throw new CalendarFetchError("invalid", check.reason);
    await assertResolvable(check.url, resolved, deadline);
    let response: Response;
    try {
      response = await resolved.doFetch(check.url.toString(), { redirect: "manual", signal });
    } catch (error) {
      throw fetchErrorFromCause(error);
    }
    if (response.status >= 300 && response.status < 400) {
      await discardBody(response);
      if (hop >= resolved.maxRedirects) throw new CalendarFetchError("invalid", "too many redirects");
      const location = response.headers.get("location");
      if (location === null || location === "") {
        throw new CalendarFetchError("invalid", "redirect response without a location");
      }
      let next: URL;
      try {
        next = new URL(location, check.url);
      } catch {
        throw new CalendarFetchError("invalid", "redirect location did not parse");
      }
      currentUrl = next.toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      await discardBody(response);
      throw new CalendarFetchError("unreachable", `the feed responded with status ${response.status}`);
    }
    return await readFeedBody(response, resolved, deadline);
  }
}

/**
 * Resolves the hostname and rejects blocked addresses before the fetch. An IP
 * literal was already judged by validateCalendarUrl. Resolution failure fails
 * closed, and a hostname that resolves to no address is treated as a failure.
 */
async function assertResolvable(url: URL, deps: FetchDeps, deadline: number): Promise<void> {
  if (ipLiteralHost(url.hostname.toLowerCase()) !== null) return;
  let entries: DnsEntry[];
  try {
    entries = await raceDeadline(deps.resolveDns(url.hostname), deadline);
  } catch (error) {
    if (error instanceof CalendarFetchError) throw error;
    throw new CalendarFetchError("unreachable", "the feed host could not be resolved");
  }
  if (entries.length === 0) {
    throw new CalendarFetchError("unreachable", "the feed host resolved to no addresses");
  }
  for (const entry of entries) {
    if (isBlockedAddress(entry.address)) {
      throw new CalendarFetchError("blocked", "the feed host resolves to a blocked address");
    }
  }
}

/**
 * Reads and checks a successful response: accepted calendar content types
 * only, a Content-Length pre-check, a cumulative stream cap a lying server
 * cannot bypass, and a body that starts with BEGIN:VCALENDAR.
 */
const ACCEPTED_CONTENT_TYPES = new Set([
  "text/calendar",
  "application/calendar",
  "application/ics",
  "text/plain",
  "application/octet-stream",
]);

/** Releases a rejected response's connection so the transfer actually stops. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The stream was already closed or errored; nothing left to release.
  }
}

async function readFeedBody(response: Response, deps: FetchDeps, deadline: number): Promise<string> {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    await discardBody(response);
    throw new CalendarFetchError("invalid", "the response is not a calendar content type");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > deps.maxBytes) {
    await discardBody(response);
    throw new CalendarFetchError("invalid", "the feed body exceeds the size limit");
  }
  try {
    const body = await readBodyCapped(response, deps.maxBytes, deadline);
    if (!/^\s*BEGIN:VCALENDAR/i.test(body)) {
      throw new CalendarFetchError("invalid", "the response does not start with BEGIN:VCALENDAR");
    }
    return body;
  } catch (error) {
    // A server that drops the connection mid-read surfaces here as a raw
    // stream error; map it onto the same timeout/unreachable split as fetches.
    throw fetchErrorFromCause(error);
  }
}

/** Decodes the body with a cumulative byte cap, so oversized bodies abort mid-stream. */
async function readBodyCapped(response: Response, maxBytes: number, deadline: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder("utf-8");
  let decoded = "";
  let total = 0;
  try {
    for (;;) {
      if (Date.now() >= deadline) throw new CalendarFetchError("timeout", "reading the feed timed out");
      const chunk = await raceDeadline(reader.read(), deadline);
      if (chunk.done) break;
      if (chunk.value !== undefined) {
        total += chunk.value.byteLength;
        if (total > maxBytes) throw new CalendarFetchError("invalid", "the feed body exceeds the size limit");
        decoded += decoder.decode(chunk.value, { stream: true });
      }
    }
    return decoded + decoder.decode();
  } catch (error) {
    await cancelReader(reader);
    throw error;
  }
}

/** Cancels a reader best-effort so a rejected transfer does not stay open until the deadline. */
async function cancelReader(reader: ReadableStreamDefaultReader): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream was already closed or errored; nothing left to release.
  }
}

/** Rejects when the promise does not settle before the shared deadline. */
function raceDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new CalendarFetchError("timeout", "the feed timed out")),
      Math.max(0, deadline - Date.now()),
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Maps a thrown fetch onto the route's timeout/unreachable split. */
function fetchErrorFromCause(error: unknown): CalendarFetchError {
  if (error instanceof CalendarFetchError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return new CalendarFetchError("timeout", "the feed timed out");
  }
  return new CalendarFetchError("unreachable", "the feed could not be reached");
}
