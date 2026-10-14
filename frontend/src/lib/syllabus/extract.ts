/**
 * Rule-based extraction of three facts from UNT syllabus text: the attendance
 * policy, the number of exams, and the grading weights.
 *
 * House rules:
 * - Every result carries the exact quoted sentence and its character offsets
 *   in the text it was found in. The quote is evidence, not a summary.
 * - When a fact is not stated, the result is `found: false`. The extractor
 *   never guesses: no defaults, no inference from course titles, no counting
 *   schedule rows as exam totals.
 * - Everything is deterministic and offline. The input is the same text the
 *   study's fetcher reconstructs from the posted syllabus.
 */

export interface FactSource {
  /** The exact sentence, as it appears in the input text. */
  quote: string;
  /** Character offset of the quote start in the input text. */
  start: number;
  /** Character offset just past the quote end in the input text. */
  end: number;
}

export type FactResult =
  | { found: true; source: FactSource }
  | { found: false; reason: string };

export interface GradingComponent {
  name: string;
  weightPct: number;
  source: FactSource;
}

export interface SyllabusFacts {
  /** A sentence that states an attendance requirement or consequence. */
  attendancePolicy: FactResult;
  /** An explicitly stated number of exams. */
  examCount: FactResult & { count?: number };
  /**
   * Grading components with percentage weights, taken from a grading context
   * (a grading heading or sentence about grade distribution).
   */
  gradingWeights:
    | { found: true; components: GradingComponent[]; source: FactSource }
    | { found: false; reason: string };
}

interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * Sentence splitting that keeps offsets stable. A sentence ends at a run of
 * `.`, `!`, or `?` followed by whitespace and something that can start a
 * sentence, or at a newline. Abbreviations followed by lowercase ("e.g.",
 * "Dr. Smith" mid-sentence continuations) are left inside the sentence.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  const push = (end: number): void => {
    const raw = text.slice(start, end);
    const trimmedStart = start + (raw.length - raw.trimStart().length);
    const trimmed = raw.trim();
    if (trimmed) sentences.push({ text: trimmed, start: trimmedStart, end: trimmedStart + trimmed.length });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i);
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      let j = i + 1;
      while (j < text.length && (text[j] === "." || text[j] === "!" || text[j] === "?")) j++;
      const after = text[j + 1] ?? "";
      const atEnd = j >= text.length;
      const whitespaceFollowedByStarter = /\s/.test(text[j]) && /[A-Z0-9"'([]/.test(after);
      // "e.g.", "Dr.", "No. 3": a short or abbreviated token before the
      // period is not a sentence end.
      const preceding = (text.slice(start, j).match(/[A-Za-z][A-Za-z.]*$/) ?? [""])[0].replace(/\.$/, "");
      const abbreviation =
        /(?:^|\.)(?:[A-Za-z]|e\.g|i\.e|etc|Dr|Mr|Mrs|Ms|Prof|vs|No|Inc|approx|Fig)$/i.test(preceding) &&
        preceding.length <= 4;
      if ((atEnd || whitespaceFollowedByStarter) && !abbreviation) {
        push(j);
        i = j - 1;
      } else {
        i = j - 1;
      }
    }
  }
  push(text.length);
  return sentences;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%.]+/g, " ").trim();
}

// Words that turn a sentence into a policy statement rather than a passing
// mention of the topic.
const ATTENDANCE_POLICY_SIGNAL =
  /\b(required|require|required to attend|requirement|mandatory|obligat\w*|expect\w*|policy|allowed|allow\w*|permitted|tolerated|excused|unexcused|absence|absences|absent|will be taken|may (result|affect|be dropped)|affect\w* (your )?(grade|final|score)|drop\w*|withdraw\w*|penal\w*|deduct\w*|lower\w*|reduction|participation|seat (time|loss)|first (two|three|four|five|\d+) (absence|absences|unexcused))\b/i;

const ATTENDANCE_TERM = /\b(attend\w*|absen\w*)\b/i;

function attendancePolicy(sentences: Sentence[]): FactResult {
  let best: { sentence: Sentence; score: number } | null = null;
  for (const sentence of sentences) {
    if (!ATTENDANCE_TERM.test(sentence.text)) continue;
    // Schedule lines and topic lists mention attendance without stating a
    // policy; require a signal word in the same sentence.
    if (!ATTENDANCE_POLICY_SIGNAL.test(sentence.text)) continue;
    // A bare heading ("Attendance Policy") is a location, not a statement.
    if (sentence.text.length < 25 && !/\d/.test(sentence.text)) continue;
    const score =
      (/\b(attendance|absence\w*)\b/i.test(sentence.text) ? 2 : 0) +
      (/\d/.test(sentence.text) ? 1 : 0) +
      (/\b(grade|final|dropp\w*|withdraw\w*|penal\w*|affect\w*|excused|unexcused)\b/i.test(sentence.text) ? 1 : 0);
    if (!best || score > best.score) best = { sentence, score };
  }
  if (!best) return { found: false, reason: "no sentence states an attendance policy" };
  return {
    found: true,
    source: { quote: best.sentence.text, start: best.sentence.start, end: best.sentence.end },
  };
}

interface CountMention {
  count: number;
}

/**
 * Find count phrases like "three exams", "4 exams", "two midterm exams",
 * including sums across "plus"/"and" ("two midterms and a final" is 3). If
 * the sentence talks about exams but no count is stated, there is no result:
 * counting rows of a schedule would be a guess.
 */
function examCountPhrase(sentence: string): CountMention[] {
  const mentions: CountMention[] = [];
  const numberWord = /(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})/i;
  const phrase = new RegExp(
    `\\b(${numberWord.source})\\s*(?:(?:\\w+\\s+){0,2}?)(exams|exam|midterms|midterm|tests|test|finals|final)\\b(?!(?:\\s*(?:is|are|was|were|will|counts|count|worth|covers|covers|schedule|date|time)))(?![^.,;]{0,20}\\bpercent|%)`,
    "gi",
  );
  for (const match of sentence.matchAll(phrase)) {
    const raw = match[1].toLowerCase();
    const count = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
    if (count === undefined || count < 1 || count > 20) continue;
    mentions.push({ count });
  }
  return mentions;
}

const EXAM_TOPIC = /\b(exams?|midterms?|tests?|final exam|finals?)\b/i;
const EXAM_NOISE =
  /\b(exam\s*(?:1|2|3|4|5|#\d)|study guide|review session|make-?up|exam date|exam schedule|final exam schedule)\b/i;

function examCount(sentences: Sentence[]): FactResult & { count?: number } {
  const candidates: { sentence: Sentence; total: number }[] = [];
  for (const sentence of sentences) {
    if (!EXAM_TOPIC.test(sentence.text)) continue;
    // "Exam 3 covers chapters 5-6" is a schedule entry, not a total.
    if (EXAM_NOISE.test(sentence.text)) continue;
    const introducer =
      /\b(there (?:are|will be)|you (?:will |may )?(?:have|take)|we (?:will |may )?(?:have|take)|i (?:will )?(?:have|give)|will (?:have|be)|consists? of|include[sd]?|plus|and)\b/i;
    const mentions = examCountPhrase(sentence.text);
    if (mentions.length === 0) continue;
    const introOk = introducer.test(sentence.text) || /\bexams?\b/i.test(sentence.text);
    if (!introOk) continue;
    // "three exams" as one mention is the total. Multiple mentions joined in
    // one sentence ("two midterms and a final") sum when the sentence reads
    // as an enumeration; otherwise the first mention is the stated total.
    const enumeration = mentions.length > 1 && /\b(and|plus)\b/i.test(sentence.text);
    const total = enumeration ? mentions.reduce((sum, m) => sum + m.count, 0) : mentions[0].count;
    candidates.push({ sentence, total });
  }
  if (candidates.length === 0) return { found: false, reason: "no sentence states a number of exams" };
  // Prefer the clearest statement: a sentence naming a total outright.
  const preferred =
    candidates.find((c) => /\b(there (?:are|will be)|you will (?:have|take)|will (?:have|take)|consists? of)\b/i.test(c.sentence.text)) ??
    candidates[0];
  return {
    found: true,
    count: preferred.total,
    source: { quote: preferred.sentence.text, start: preferred.sentence.start, end: preferred.sentence.end },
  };
}

const GRADING_CONTEXT =
  /\b(grading|graded|grade distribution|grade breakdown|grades? (?:are|will be) (?:based|determined|computed)|assessment|evaluation|course requirements|weights?|weighted)\b/i;

interface WeightPair {
  name: string;
  weightPct: number;
}

function weightPairs(block: string): WeightPair[] {
  const pairs: WeightPair[] = [];
  const pattern = /([A-Za-z][A-Za-z0-9'&/ +( ).-]{0,34}?)\s*[:\u2013\u2014-]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/gi;
  for (const match of block.matchAll(pattern)) {
    let name = match[1]
      .replace(/^[\s:;,.\-]+/, "")
      .replace(/\s*[:;,.\-]+\s*$/, "")
      .replace(/\s+(?:of|is|are|worth|at)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const weight = Number(match[2]);
    if (!name || name.length < 2 || weight <= 0 || weight > 100) continue;
    // The capture tends to drag in the preceding sentence's tail or a
    // bullet; keep the last meaningful words.
    const tail = name.split(/[,;.]|\b(?:and|the|your|course|final|each)\b/i).pop() ?? name;
    name = tail.trim() || name;
    pairs.push({ name, weightPct: weight });
  }
  return pairs;
}

function gradingWeights(text: string, sentences: Sentence[]): SyllabusFacts["gradingWeights"] {
  // Grade tables in PDF text survive as short lines. A weights sentence is
  // either self-describing ("Grading: Exams 60%...") or sits directly under
  // a grading heading; both count as context. Blocks are scored by how
  // close their weights sum to 100.
  const headingLike = (line: string): boolean => line.length > 0 && line.length <= 60 && GRADING_CONTEXT.test(line);
  const blocks = new Map<string, { pairs: WeightPair[]; sentence: Sentence }>();
  for (const sentence of sentences) {
    const precedingLines = text.slice(0, sentence.start).split("\n").slice(-3).map((line) => line.trim());
    const inContext =
      GRADING_CONTEXT.test(sentence.text) || precedingLines.some(headingLike);
    if (!inContext) continue;
    const pairs = weightPairs(sentence.text);
    if (pairs.length === 0) continue;
    const key = sentence.start.toString();
    blocks.set(key, { pairs, sentence });
  }
  const scored = [...blocks.values()]
    .map(({ pairs, sentence }) => {
      const total = pairs.reduce((sum, p) => sum + p.weightPct, 0);
      return { pairs, sentence, total, distance: Math.abs(total - 100) };
    })
    .filter((b) => b.pairs.length >= 2 || (b.pairs.length === 1 && b.total >= 90 && b.total <= 110))
    .sort((a, b) => a.distance - b.distance);
  if (scored.length === 0) return { found: false, reason: "no grading block lists percentage weights" };
  const best = scored[0];
  if (best.total < 85 || best.total > 115) {
    return { found: false, reason: "weight block does not sum to a plausible total" };
  }
  const components: GradingComponent[] = best.pairs.map((pair) => {
    const at = best.sentence.text.indexOf(`${pair.name}`);
    return {
      name: pair.name,
      weightPct: pair.weightPct,
      source: {
        quote: best.sentence.text,
        start: best.sentence.start + Math.max(0, at),
        end: best.sentence.end,
      },
    };
  });
  return { found: true, components, source: { quote: best.sentence.text, start: best.sentence.start, end: best.sentence.end } };
}

/**
 * Extract the three study facts from syllabus text. Purely rule-based and
 * deterministic: the same text always yields the same result, and a fact the
 * rules cannot ground in a quoted sentence is reported as not found.
 */
export function extractSyllabusFacts(text: string): SyllabusFacts {
  const sentences = splitSentences(text);
  return {
    attendancePolicy: attendancePolicy(sentences),
    examCount: examCount(sentences),
    gradingWeights: gradingWeights(text, sentences),
  };
}

/** Normalized comparison helper used by the study's evaluation script. */
export function normalizeForComparison(value: string): string {
  return normalize(value);
}
