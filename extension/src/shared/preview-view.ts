import type { Preview, UnknownReason } from "./extension-api";
import type { MarkerState } from "./marker-states";

/** The panel's "Against Main" sentence, and which detail lines are left for "More". */
export type Verdict = { marker: MarkerState; words: string; more: string[] };

const UNKNOWN_COPY: Record<UnknownReason, string> = {
  "no-set-time": "This section has no set meeting time, so there's nothing to compare.",
  "schedule-time-missing": "A section in Main has no set time, so UNTangle can't rule out an overlap.",
  "schedule-unavailable": "UNTangle couldn't check this section against Main.",
};

/** "A", "A and B", "A, B and C". */
export function joined(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function verdictOf(p: Preview): Verdict {
  if (p.inSchedule === true)
    return { marker: "added", words: `${p.title} is already in Main.`, more: p.details };
  if (p.conflict === "conflict") {
    // A course that clashes on several days is one clash per day; the sentence names it once.
    const names = [...new Set((p.clashes ?? []).map(c => c.kind === "busy" ? `your busy time “${c.name}”` : c.name))];
    return { marker: "conflict", words: names.length > 0 ? `Overlaps ${joined(names)}.` : "Overlaps something in Main.", more: p.details };
  }
  if (p.conflict === "clear")
    return { marker: "clear", words: "Fits Main. It overlaps none of your classes or busy times.", more: p.details };
  // UNTangle puts its reason for an unknown verdict first in the details
  // (frontend/src/server/extension/preview.ts). It is more specific than the
  // reason code, so it is the verdict, and "More" doesn't repeat it.
  const [reason, ...rest] = p.details;
  if (reason)
    return { marker: "unknown", words: reason, more: rest };
  return { marker: "unknown", words: p.unknownReason ? UNKNOWN_COPY[p.unknownReason] : "UNTangle couldn't compare this section's times with Main.", more: p.details };
}

/**
 * Whether the panel offers "Add to Main". Nothing could be checked against
 * Main when it is missing, plans another term, or UNTangle's term data lacks
 * the section. UNTangle refuses the add in the first and last cases
 * (frontend/tests/extension/routes.test.ts pins it). For a Main of another
 * term it could add that term's section with the same class number, which is
 * not the one on screen. The panel offers no add in any of them.
 */
export function canAdd(p: Preview): boolean {
  if (p.inSchedule === true)
    return false;
  return !(p.conflict === "unknown" && p.unknownReason === "schedule-unavailable");
}
