/**
 * Character-level name folding for instructor matching.
 *
 * Pure and deterministic: an explicit accent map, ASCII case folding and
 * punctuation stripping. No locale-dependent APIs (no toLocaleLowerCase, no
 * Intl), no Unicode normalization forms, so the same input folds to the same
 * tokens on every runtime.
 */

/** Explicit accented-character map. Keys are single characters; values may expand. */
const ACCENT_MAP: Record<string, string> = {
  "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "ā": "a", "ă": "a", "ą": "a",
  "ç": "c", "ć": "c", "č": "c", "ĉ": "c",
  "đ": "d", "ď": "d",
  "è": "e", "é": "e", "ê": "e", "ë": "e", "ē": "e", "ė": "e", "ę": "e", "ě": "e",
  "ì": "i", "í": "i", "î": "i", "ï": "i", "ī": "i", "į": "i",
  "ł": "l", "ĺ": "l", "ľ": "l",
  "ñ": "n", "ń": "n", "ň": "n",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o", "ō": "o", "ő": "o",
  "ù": "u", "ú": "u", "û": "u", "ü": "u", "ū": "u", "ů": "u", "ű": "u", "ų": "u",
  "ý": "y", "ÿ": "y",
  "ž": "z", "ź": "z", "ż": "z", "š": "s", "ś": "s",
  "ř": "r", "ŕ": "r", "ť": "t",
  "ß": "ss", "æ": "ae", "œ": "oe",
  "'": "'", "’": "'", "ˈ": "'", "ʼ": "'",
  "­": "-", "—": "-", "−": "-",
};

/** Replaces accented and typographic characters with their folded ASCII form. */
export function foldAccents(text: string): string {
  let out = "";
  for (const ch of text) out += ACCENT_MAP[ch] ?? ch;
  return out;
}

/**
 * Folds a name field for comparison: lowercase, accents folded, combining
 * marks stripped (the lowercase of a dotted capital I decomposes into a base
 * letter plus one), apostrophes and periods widened to spaces (adjacent
 * initials like "M.T." stay separate initials), hyphens widened to spaces,
 * whitespace collapsed.
 * Commas and semicolons survive: they are structural separators, handled by
 * the section-field parser, so this must only be applied to whole fields or
 * to structured candidate names, never relied on to keep them.
 */
export function foldName(text: string): string {
  return foldAccents(text.toLowerCase())
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019\u02BC`]/g, "")
    .replace(/\./g, " ")
    .replace(/[\u00AD\u2013\u2014\u2212-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when folded text contains anything beyond tokens and field separators.
 * Unknown punctuation, letters and marks must abstain: splitting on them can
 * invent initials, as in "J@ane" becoming "j" and "ane".
 */
export function hasUnsupportedCharacters(folded: string): boolean {
  return /[^a-z0-9 ,;]/.test(folded);
}

/** Splits a folded string into lowercase alphanumeric tokens. */
export function tokenize(folded: string): string[] {
  return folded.match(/[a-z0-9]+/g) ?? [];
}

const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Strips trailing name suffixes (Jr, Sr, II, III, IV) from a token list,
 * keeping at least one token. A suffix never bridges two different people:
 * it is removed from both sides before any comparison.
 */
export function stripSuffixTokens(tokens: string[]): { tokens: string[]; suffix: string | null } {
  const kept = [...tokens];
  const stripped: string[] = [];
  while (kept.length > 1 && SUFFIX_TOKENS.has(kept[kept.length - 1] ?? "")) {
    stripped.unshift(kept.pop() ?? "");
  }
  return { tokens: kept, suffix: stripped[0] ?? null };
}
