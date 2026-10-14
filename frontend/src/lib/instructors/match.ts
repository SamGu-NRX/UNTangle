/**
 * Abstain-first matcher from a section's instructor field to a grade-history
 * instructor identity.
 *
 * Pure, deterministic and network-free: no imports beyond the local fold and
 * parse helpers, no clocks, no randomness, no locale-dependent APIs. It only
 * matches on positive name evidence (surname token-set equality after
 * folding, first-name or initial consistency, no contradictory middle data)
 * and abstains for every weak or ambiguous case. No edit distance, no
 * phonetics, no nickname dictionary.
 */
import { foldName, hasUnmappedLetters, stripSuffixTokens, tokenize } from "./fold";
import { parseSectionField, type PersonName } from "./parse";

/** A grade-history identity, as untgrades reports it. */
export type Candidate = {
  /** The untgrades identity id (the JSON name-pair string). */
  id: string;
  /** "First Last" as untgrades reports it. Carried, never parsed for evidence. */
  name: string;
  firstName: string;
  lastName: string;
};

export type MatchResult = {
  /** Null means abstain: the evidence was too weak or ambiguous to claim a match. */
  candidateId: string | null;
  /** 0 to 1. Monotone in the strength of the evidence for returned matches; 0 when abstaining. */
  confidence: number;
  /** Short stable phrase naming why the matcher matched or abstained. */
  reason: string;
};

/** At or above this a match is returned; below it the matcher abstains. */
export const CONFIDENCE_THRESHOLD = 0.9;

/** Surname plus a consistent first-name initial: the weakest evidence that can return a match. */
const INITIAL_CONFIDENCE = 0.9;
/** Surname plus one compared full first-name token. */
const EXACT_SINGLE_CONFIDENCE = 0.95;
/** Surname plus two or more compared full first-name tokens. */
const EXACT_MULTI_CONFIDENCE = 1;

type FoldedCandidate = { id: string; lastTokens: string[]; firstTokens: string[]; unsupported: boolean };

type ComboOutcome =
  | { kind: "surname-mismatch" }
  | { kind: "insufficient-first" }
  | { kind: "first-contradiction" }
  | { kind: "qualified"; confidence: number; initial: boolean };

function personKey(person: PersonName): string {
  return `${person.surnameTokens.join("+")}|${person.firstTokens.join("+")}|${person.suffix ?? ""}`;
}

function foldCandidate(candidate: Candidate): FoldedCandidate {
  const foldedFirst = foldName(typeof candidate.firstName === "string" ? candidate.firstName : "");
  const foldedLast = foldName(typeof candidate.lastName === "string" ? candidate.lastName : "");
  const last = stripSuffixTokens(tokenize(foldedLast));
  const first = stripSuffixTokens(tokenize(foldedFirst));
  const unsupported = hasUnmappedLetters(foldedFirst) || hasUnmappedLetters(foldedLast);
  return { id: candidate.id, lastTokens: last.tokens, firstTokens: first.tokens, unsupported };
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((token, i) => token === sortedB[i]);
}

/**
 * Scores one section person against one candidate. The surname gate is token
 * sets ("Garcia-Lopez" equals "Garcia Lopez" and "Lopez Garcia"); first names
 * compare token by token, where an initial is consistent with a full token it
 * prefixes, a disagreement at a shared position contradicts, and a token
 * present on only one side is unknown, not a contradiction.
 */
function scorePair(person: PersonName, candidate: FoldedCandidate): ComboOutcome {
  const partitions = [
    { surnameTokens: person.surnameTokens, firstTokens: person.firstTokens },
    ...(person.surnameOptions ?? []),
  ];
  let surnameMatched = false;
  let anyContradicted = false;
  for (const partition of partitions) {
    if (!sameTokens(partition.surnameTokens, candidate.lastTokens)) continue;
    surnameMatched = true;
    const compared = Math.min(partition.firstTokens.length, candidate.firstTokens.length);
    if (compared === 0) continue;
    let initial = false;
    let contradicted = false;
    for (let i = 0; i < compared; i++) {
      const a = partition.firstTokens[i] ?? "";
      const b = candidate.firstTokens[i] ?? "";
      if (a === b) {
        if (a.length === 1) initial = true;
        continue;
      }
      if (a.length === 1 && b.startsWith(a)) { initial = true; continue; }
      if (b.length === 1 && a.startsWith(b)) { initial = true; continue; }
      contradicted = true;
      break;
    }
    if (contradicted) { anyContradicted = true; continue; }
    const confidence = initial
      ? INITIAL_CONFIDENCE
      : compared > 1 ? EXACT_MULTI_CONFIDENCE : EXACT_SINGLE_CONFIDENCE;
    return { kind: "qualified", confidence, initial };
  }
  if (surnameMatched) return anyContradicted ? { kind: "first-contradiction" } : { kind: "insufficient-first" };
  return { kind: "surname-mismatch" };
}

function abstain(reason: string): MatchResult {
  return { candidateId: null, confidence: 0, reason };
}

/**
 * Matches the section's instructor field against the grade-history candidates
 * in scope and returns the one identity the evidence supports, or abstains.
 * A candidate is returned only when exactly one parsed person from the field
 * clears the threshold against exactly one candidate; insufficient evidence
 * and ambiguity both abstain, with distinct reasons.
 */
export function matchInstructor(sectionName: string, candidates: readonly Candidate[]): MatchResult {
  const parsed = parseSectionField(typeof sectionName === "string" ? sectionName : "");
  if (parsed.kind === "unusable") return abstain(`section instructor is ${parsed.word}`);
  if (parsed.kind === "unparseable") return abstain("section instructor field is unparseable");
  if (parsed.kind === "unsupported") return abstain("section instructor name has unsupported characters");
  if (candidates.length === 0) return abstain("no candidates provided");

  // The same real person can appear twice in one team-taught field; dedupe.
  const seen = new Set<string>();
  const people = parsed.people.filter(person => {
    const key = personKey(person);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Duplicate candidate ids are the same identity listed twice.
  const byId = new Map<string, FoldedCandidate>();
  for (const candidate of candidates) byId.set(candidate.id, foldCandidate(candidate));

  const qualified: { person: PersonName; candidate: FoldedCandidate; initial: boolean; confidence: number }[] = [];
  let surnameMatched = false;
  let firstNameContradicted = false;
  for (const person of people) {
    for (const candidate of byId.values()) {
      // Unsupported letters can tokenize as false initials, so they provide no evidence.
      if (candidate.unsupported) continue;
      const outcome = scorePair(person, candidate);
      if (outcome.kind === "surname-mismatch") continue;
      surnameMatched = true;
      if (outcome.kind === "insufficient-first") continue;
      if (outcome.kind === "first-contradiction") { firstNameContradicted = true; continue; }
      if (outcome.confidence >= CONFIDENCE_THRESHOLD) {
        qualified.push({ person, candidate, initial: outcome.initial, confidence: outcome.confidence });
      }
    }
  }

  if (qualified.length === 0) {
    return abstain(
      firstNameContradicted
        ? "section surname matches but the first name does not"
        : surnameMatched
          ? "section surname matches but first-name evidence is insufficient"
          : "no candidate shares the section surname",
    );
  }

  const candidateIds = new Set(qualified.map(q => q.candidate.id));
  const personKeys = new Set(qualified.map(q => personKey(q.person)));
  if (candidateIds.size > 1 && personKeys.size > 1) {
    return abstain("ambiguous: the section field matches several people");
  }
  if (candidateIds.size > 1) return abstain("ambiguous: several candidates match the section name");
  if (personKeys.size > 1) return abstain("ambiguous: several section people match one candidate");

  const winner = qualified[0];
  if (!winner) return abstain("no candidates provided");
  const reason = winner.initial
    ? "matched on surname and first-name initial"
    : winner.confidence >= EXACT_MULTI_CONFIDENCE
      ? "matched on surname and full first name"
      : "matched on surname and first name";
  const listedReason = people.length > 1
    ? `one of ${people.length} listed instructors; ${reason}`
    : reason;
  return { candidateId: winner.candidate.id, confidence: winner.confidence, reason: listedReason };
}
