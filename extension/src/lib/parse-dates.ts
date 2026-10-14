/**
 * Date-range parsing for the overlap guard in conflict semantics
 * (sections/INTEGRATION.md: compare meetings only where their date ranges
 * overlap). Page rows carry MM/DD/YYYY text; the sections API carries ISO
 * dates. Pure and deterministic.
 */
export type DateSpan = { startMs: number | null; endMs: number | null };

/** "01/19/2027 - 05/07/2027" (or with an en dash style separator "-"). */
export function parsePageDateRange(text: string): DateSpan {
  const parts = text.trim().split(/\s*-\s*/);
  if (parts.length !== 2) return { startMs: null, endMs: null };
  return { startMs: parseMdy(parts[0] ?? ""), endMs: parseMdy(parts[1] ?? "") };
}

/** The sections API's DateRange start/end are ISO dates or null. */
export function parseIsoDateSpan(start: string | null, end: string | null): DateSpan {
  return { startMs: parseIso(start), endMs: parseIso(end) };
}

/** Both bounds present, so overlap can be decided. */
export function spanIsUsable(span: DateSpan): span is { startMs: number; endMs: number } {
  return span.startMs !== null && span.endMs !== null;
}

/**
 * Whether two spans overlap. Null means undecidable (a side has no usable
 * range); callers treat undecidable as potentially overlapping, never as a
 * clean bill.
 */
export function rangesOverlap(a: DateSpan, b: DateSpan): boolean | null {
  if (!spanIsUsable(a) || !spanIsUsable(b)) return null;
  return a.endMs >= b.startMs && b.endMs >= a.startMs;
}

function parseMdy(text: string): number | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  return Number.isFinite(time) ? time : null;
}

function parseIso(text: string | null): number | null {
  if (text === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}
