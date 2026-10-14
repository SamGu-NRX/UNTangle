import { foldName, hasUnmappedLetters, stripSuffixTokens, tokenize } from "./fold";

/** One person parsed out of a section's instructor field, folded and tokenized. */
export type PersonName = {
  /** Surname tokens after folding, suffix stripped. Order kept; compared as token sets. */
  surnameTokens: string[];
  /** Given-name and middle tokens in order. Empty for a stray single-token field. */
  firstTokens: string[];
  /** Trailing suffix (Jr, Sr, II, III, IV) stripped from either slot, or null. */
  suffix: string | null;
  /**
   * Alternative surname partitions for comma-less segments. A display name
   * like "Fernando Mosquera Ferrandiz" cannot say where a compound surname
   * starts, so every trailing token block (shortest first, at least one token
   * left over for the given name) is a candidate surname; the raw "Last,First"
   * form needs none of this and leaves the field empty.
   */
  surnameOptions?: { surnameTokens: string[]; firstTokens: string[] }[];
};

/** What the section's instructor field parses into. */
export type SectionPeople =
  | { kind: "unusable"; word: "tba" | "staff" | "closed" | "none" | "blank" }
  | { kind: "unparseable"; folded: string }
  | { kind: "unsupported"; folded: string }
  | { kind: "people"; people: PersonName[] };

const PLACEHOLDER_WORDS = new Set(["tba", "staff", "closed"]);
const NONE_WORD = "none";

function personOf(
  surnameTokens: string[],
  firstTokens: string[],
  suffix: string | null,
  surnameOptions?: { surnameTokens: string[]; firstTokens: string[] }[],
): PersonName {
  return surnameOptions ? { surnameTokens, firstTokens, suffix, surnameOptions } : { surnameTokens, firstTokens, suffix };
}

/**
 * For a comma-less segment of n tokens, every trailing token block is a
 * possible surname (with the tokens before it the given name), so the matcher
 * can pair "Fernando Mosquera Ferrandiz" with the compound-surname candidate
 * "Fernando" + "Mosquera Ferrandiz" just as the raw pair form already does.
 */
function surnamePartitions(tokens: string[]): { surnameTokens: string[]; firstTokens: string[] }[] {
  const options: { surnameTokens: string[]; firstTokens: string[] }[] = [];
  for (let k = 2; k < tokens.length; k++) {
    options.push({ surnameTokens: tokens.slice(tokens.length - k), firstTokens: tokens.slice(0, tokens.length - k) });
  }
  return options;
}

/** Parses a whole display-form field ("First Last" segments joined by "; "). */
function parseDisplayField(folded: string): SectionPeople {
  const people: PersonName[] = [];
  for (const segment of folded.split(";")) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { tokens: kept, suffix } = stripSuffixTokens(tokens);
    if (kept.length === 0) continue;
    if (kept.length === 1) {
      people.push(personOf(kept, [], suffix));
      continue;
    }
    people.push(personOf([kept[kept.length - 1] ?? ""], kept.slice(0, -1), suffix, surnamePartitions(kept)));
  }
  if (people.length === 0) return { kind: "unusable", word: "blank" };
  return { kind: "people", people };
}

/**
 * Parses a raw vsb field of comma-paired "Last,First" people, mirroring the
 * feed's own normalizer: standalone None placeholder words vanish before
 * pairing, so "None, Lee,Annie Seong" and a stray None glued to a team field
 * both realign into the people the feed means. An odd part count after that
 * is garbage pairing the feed itself cannot resolve, so it stays unparseable.
 */
function parseRawField(folded: string): SectionPeople {
  const rawParts = folded.split(",").map(part => part.trim()).filter(part => part.length > 0);
  if (rawParts.length === 0) return { kind: "unusable", word: "blank" };
  const parts = rawParts
    .map(part => part.split(" ").filter(token => token !== NONE_WORD).join(" ").trim())
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    const words = folded.split(/[\s,]+/).filter(Boolean);
    return words.includes(NONE_WORD)
      ? { kind: "unusable", word: "none" }
      : { kind: "unusable", word: "blank" };
  }
  if (parts.length === 1) {
    const tokens = tokenize(parts[0] ?? "");
    if (tokens.length === 0) return { kind: "unusable", word: "blank" };
    if (PLACEHOLDER_WORDS.has(tokens[0] ?? "") && tokens.length === 1) {
      return { kind: "unusable", word: tokens[0] as "tba" | "staff" | "closed" };
    }
    const { tokens: kept, suffix } = stripSuffixTokens(tokens);
    if (kept.length === 1) return { kind: "people", people: [personOf(kept, [], suffix)] };
    return {
      kind: "people",
      people: [personOf([kept[kept.length - 1] ?? ""], kept.slice(0, -1), suffix, surnamePartitions(kept))],
    };
  }
  if (parts.length % 2 === 1) return { kind: "unparseable", folded };
  const people: PersonName[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const surname = stripSuffixTokens(tokenize(parts[i] ?? ""));
    const first = stripSuffixTokens(tokenize(parts[i + 1] ?? ""));
    if (surname.tokens.length === 0 && first.tokens.length === 0) continue;
    people.push(personOf(surname.tokens, first.tokens, surname.suffix ?? first.suffix));
  }
  if (people.length === 0) return { kind: "unusable", word: "blank" };
  return { kind: "people", people };
}

/**
 * Parses the section's instructor field into people, or reports why it cannot.
 * Accepts the raw vsb form (one or several "Last,First" comma pairs, None
 * placeholders mixed in) and the "First Last" display form (one person, or
 * several joined by "; "). Never throws: messy input abstains with a reason.
 */
export function parseSectionField(sectionName: string): SectionPeople {
  const folded = foldName(typeof sectionName === "string" ? sectionName : "");
  if (!folded) return { kind: "unusable", word: "blank" };
  if (PLACEHOLDER_WORDS.has(folded)) {
    return { kind: "unusable", word: folded as "tba" | "staff" | "closed" };
  }
  if (hasUnmappedLetters(folded)) return { kind: "unsupported", folded };
  if (folded.includes(";")) return parseDisplayField(folded);
  return parseRawField(folded);
}
