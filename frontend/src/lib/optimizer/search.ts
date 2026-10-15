/**
 * Exact branch-and-bound over the prepared candidates.
 *
 * The search assigns one course at a time, always the unassigned course with
 * the fewest sections still possible. After each assignment it removes every
 * section that conflicts with it from the other courses (a bitset AND), and
 * abandons the branch when a course has none left.
 *
 * Each branch gets a lower bound on the cost of any schedule that completes
 * it (`evaluate`). A branch whose bound is above the best schedule found so
 * far is skipped; at an equal bound, a branch that cannot win the evidence
 * and id tie-break is skipped too (`canWinTie`). The
 * bound adds up:
 * - the chosen sections' own costs (time-of-day lean and rating), plus the
 *   cheapest section still possible for every unassigned course;
 * - the days already used, plus the most new days any single unassigned
 *   course must add;
 * - per day, the idle minutes between consecutive chosen classes that the
 *   unassigned courses cannot fill (see `dayCost`), and the walks between
 *   classes nothing can come between. The walking check is applied to those
 *   same pairs, which stay back-to-back in every completion.
 * At a complete schedule nothing is unassigned, every pair is fixed, and the
 * bound is the exact cost. None of this assumes walking times obey the
 * triangle inequality; a path network need not.
 *
 * Meetings with dates (weeks.ts): the weekly path is unchanged. On a day
 * whose candidates all share one activity mask, the original bounds apply.
 * On mixed days, compute the fill, walking-floor and outside-span bounds
 * separately in each segment, then take their maximum, never their sum.
 * A course supports the outside-span bound only when every live choice has
 * an occurrence in that segment. A pair may occur in several segments but
 * the objective counts it once, which rules out adding segment bounds.
 * Independently, fixed pairs retain their exact costs across all segments;
 * combine that bound with the segment bound by maximum. The union-of-days
 * bound remains independent of dates.
 *
 * The schedule order is three tiers: lower cost first; within
 * INSTRUCTOR_TIE_BREAK_TOLERANCE of an equal cost the two plans count as
 * tied and higher instructor evidence wins; then the lower tie-break key
 * (section ids in course-code order). With integer costs the tolerance band
 * is exactly equality, so a preference is never traded for instructor
 * score.
 */

import {
  COST_PER_DAY,
  COST_PER_GAP_MINUTE,
  COST_PER_WALK_SECOND,
  INSTRUCTOR_TIE_BREAK_TOLERANCE,
  UNKNOWN_WALK_SECONDS,
} from "./score";
import { OPT_DAYS } from "./types";
import type { Candidate, Prepared, PreparedMeeting } from "./prepare";

const DAY_COUNT = OPT_DAYS.length;

/**
 * Slack for the evidence comparisons in `canWinTie`: real evidence
 * differences are at least a tenth of a gpa over the eligible-course
 * count, while double rounding error for these sums is around 1e-15, so
 * a value between the two never masks a real difference. After the
 * course-order bound below, the band is strictly redundant insurance
 * (each bound term dominates the eventual pick's, and float addition is
 * monotone), but cheap: being too big only costs a little pruning.
 */
const EVIDENCE_ROUNDING = 1e-9;

export type Budget = {
  deadline: number;
  maxNodes: number;
  now: () => number;
  nodes: number;
};

/** A complete schedule: one candidate per course, in course-code order. */
export type Leaf = {
  picks: Candidate[];
  cost: number;
  /**
   * Mean instructor evidence over the leaf's picks in evidence-eligible
   * courses (courses where every option has a known gpa; other courses
   * contribute nothing for any plan), and 0 when no course is eligible so
   * the key decides. Higher wins the tie-break. The bound in `canWinTie`
   * sums the same per-candidate `evidence` values in a different order,
   * so plans that tie in exact arithmetic may differ in their last bits
   * of rounding; the search's comparisons allow for that with
   * EVIDENCE_ROUNDING instead of assuming the two sums are identical.
   */
  evidence: number;
  /** Section ids in course-code order: the tie-break key. */
  key: string[];
};

class BudgetExhausted {}
class FoundOne {}

/** Lexicographic comparison of tie-break keys. */
export function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Strict schedule order, three tiers: lower cost first; when two costs are
 * within INSTRUCTOR_TIE_BREAK_TOLERANCE they count as tied and higher
 * instructor evidence wins; then the lower tie-break key. With integer
 * costs the tolerance band is exactly equality.
 */
export function leafBefore(a: Pick<Leaf, "cost" | "evidence" | "key">, b: Pick<Leaf, "cost" | "evidence" | "key">): boolean {
  if (Math.abs(a.cost - b.cost) > INSTRUCTOR_TIE_BREAK_TOLERANCE) return a.cost < b.cost;
  if (a.evidence !== b.evidence) return a.evidence > b.evidence;
  return compareKeys(a.key, b.key) < 0;
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

type Options = {
  /** Schedules already picked; a new one must differ from each in at least `minDifferent` courses' times. */
  previous: Leaf[];
  minDifferent: number;
  /** Stop at the first complete schedule (feasibility checks). */
  stopAtFirst: boolean;
  /** Start from this schedule as the one to beat (must satisfy the same rules). */
  incumbent: Leaf | null;
  onLeaf?: (leaf: Leaf) => void;
};

export type SearchOutcome = { best: Leaf | null; complete: boolean };

export function search(prepared: Prepared, budget: Budget, options: Options): SearchOutcome {
  const { courses, words, conflicts, walk, buildingCount, bufferSeconds, weights } = prepared;
  const n = courses.length;
  const candidateByBit: Candidate[] = [];
  for (const candidate of prepared.candidates) candidateByBit[candidate.bit] = candidate;

  let best: Leaf | null = options.incumbent;

  if (prepared.maxCredits !== null && prepared.totalCredits > prepared.maxCredits) {
    return { best: null, complete: true };
  }

  const assigned: Array<Candidate | null> = new Array(n).fill(null);
  const aliveStack: Uint32Array[] = [];
  for (let depth = 0; depth <= n; depth += 1) aliveStack.push(new Uint32Array(words));
  for (const candidate of prepared.candidates) aliveStack[0][candidate.bit >>> 5] |= 1 << (candidate.bit & 31);
  const scratch = new Uint32Array(words);
  const dayLists: PreparedMeeting[][] = Array.from({ length: DAY_COUNT }, () => []);
  // Per-day loops stop after the last day any candidate meets on; later days'
  // lists stay empty. Visiting an empty Saturday and Sunday on every node cost
  // about 5% on the 8 x 40 bench, where no class meets then.
  let anyCandidateDays = 0;
  for (const candidate of prepared.candidates) anyCandidateDays |= candidate.dayMask;
  const dayEnd = 32 - Math.clz32(anyCandidateDays);
  let daysUsed = 0;
  let selfSum = 0;
  // Per course, the most evidence any of its candidates contributes (0 for
  // an evidence-ineligible course, whose options all contribute 0). A
  // static upper bound on what an unassigned course can add; the alive
  // mask would tighten it but correctness needs only an over-estimate.
  const maxEvidenceByCourse: number[] = new Array(n).fill(0);
  for (const candidate of prepared.candidates) {
    if (candidate.evidence > maxEvidenceByCourse[candidate.course]) {
      maxEvidenceByCourse[candidate.course] = candidate.evidence;
    }
  }
  // Evidence-eligible courses; the leaf mean's divisor. 0 when no course
  // is eligible, which makes every plan's evidence 0 and the key decisive.
  const eligibleCount = prepared.courses.reduce((count, course) => count + (course.evidenceEligible ? 1 : 0), 0);
  let assignedCount = 0;
  const previous = options.previous;
  const same = new Int32Array(previous.length);
  const minDifferent = options.minDifferent;

  const walkOf = (from: number, to: number): number | null => {
    if (from < 0 || to < 0) return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };

  const { times, timeIndex, fill, walkFloor } = prepared;
  const floorStride = buildingCount + 1;
  const timeCount = times.length;
  const pairsMatter = weights.compact > 0 || weights.walking > 0 || bufferSeconds !== null;
  // A range with no occurrence has mask 0 and cannot support the weekly bounds.
  const oneSegment = prepared.weekSegments === 1 && prepared.candidates.every((c) => c.meetings.every((m) => m.weeks !== 0));

  /**
   * Lower bound on one day's idle-time and walking cost, given the courses
   * still to assign (`remaining`), or -1 when a pair breaks the walking check
   * for certain. A break between back-to-back chosen classes can only shrink
   * by what the remaining courses could put inside it: at most one class per
   * course, no longer than the longest of that course's classes that fits
   * (the `fill` table). A break nothing can enter keeps its idle minutes and
   * its walk in every completion. With one week segment the back-to-back
   * pairs are the consecutive ones. With several, this function counts only
   * fixed pairs; calendarDayCost also computes the per-segment bounds.
   */
  function weeklyOrFixedDayCost(day: number, remaining: Int32Array, remainingCount: number): number {
    const list = dayLists[day];
    let gap = 0;
    let walkCost = 0;
    for (let i = 0; i + 1 < list.length; i += 1) {
      const prev = list[i];
      let between = 0;
      for (let j = i + 1; j < list.length; j += 1) {
        const next = list[j];
        const backToBack = (prev.weeks & next.weeks & ~between) !== 0;
        between |= next.weeks;
        if (backToBack) {
          const window = next.start - prev.end;
          const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
          let filled = 0;
          if (fill === null) filled = remainingCount > 0 ? window : 0;
          else for (let r = 0; r < remainingCount && filled < window; r += 1) filled += fill[remaining[r]][day][cell];
          if (filled > 0) {
            if (oneSegment) {
              if (filled < window) gap += window - filled;
              if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
                walkCost += walkFloor[(prev.building < 0 ? buildingCount : prev.building) * floorStride + (next.building < 0 ? buildingCount : next.building)];
              }
            }
          } else {
            gap += window;
            if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
              const seconds = walkOf(prev.building, next.building);
              walkCost += seconds ?? UNKNOWN_WALK_SECONDS;
              if (bufferSeconds !== null && window * 60 < (seconds ?? UNKNOWN_WALK_SECONDS) + bufferSeconds) return -1;
            }
          }
        }
        // Every week of prev now has a class after it, before anything later.
        if ((prev.weeks & ~between) === 0) break;
      }
    }
    return weights.compact * COST_PER_GAP_MINUTE * gap + weights.walking * COST_PER_WALK_SECOND * walkCost;
  }

  // Keep the weekly hot path unchanged. Dated bounds inspect a single
  // weekday's activity at a time; no sum may count one pair in several segments.
  const dayWeeks = new Int32Array(DAY_COUNT);
  const mixedDays = new Uint8Array(DAY_COUNT);
  if (!oneSegment) {
    const firstMasks: Array<number | undefined> = new Array(DAY_COUNT);
    for (const c of prepared.candidates) for (const m of c.meetings) {
      if (firstMasks[m.day] === undefined) firstMasks[m.day] = m.weeks;
      else if (firstMasks[m.day] !== m.weeks) mixedDays[m.day] = 1;
      dayWeeks[m.day] |= m.weeks;
    }
  }

  /** Original fill and shortest-walk bounds, restricted to one activity segment. */
  function segmentDayCost(day: number, mask: number, remaining: Int32Array, count: number): number {
    let prev: PreparedMeeting | undefined;
    let cost = 0;
    for (const next of dayLists[day]) {
      if ((next.weeks & mask) === 0) continue;
      if (prev) {
        const window = next.start - prev.end;
        const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
        let filled = fill === null && count > 0 ? window : 0;
        // The tables include all dates. Overstating possible fill only lowers
        // this bound, so there is no per-segment table to build or retain.
        if (fill !== null) for (let r = 0; r < count && filled < window; r += 1) filled += fill[remaining[r]][day][cell];
        cost += weights.compact * COST_PER_GAP_MINUTE * Math.max(0, window - filled);
        if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
          let walking: number;
          if (filled === 0) {
            walking = walkOf(prev.building, next.building) ?? UNKNOWN_WALK_SECONDS;
            if (bufferSeconds !== null && window * 60 < walking + bufferSeconds) return -1;
          } else {
            walking = walkFloor[(prev.building < 0 ? buildingCount : prev.building) * floorStride + (next.building < 0 ? buildingCount : next.building)];
          }
          cost += weights.walking * COST_PER_WALK_SECOND * walking;
        }
      }
      prev = next;
    }
    return cost;
  }

  function calendarDayCost(day: number, remaining: Int32Array, count: number): number {
    if (dayLists[day].length < 2) return 0;
    // All candidates on a uniform day run together, even if other days have
    // other masks. Its original bounds need only one pass.
    if (!mixedDays[day]) return segmentDayCost(day, dayWeeks[day], remaining, count);
    const fixed = weeklyOrFixedDayCost(day, remaining, count);
    if (fixed < 0 || count === 0) return fixed;
    let bound = fixed;
    for (let bits = dayWeeks[day]; bits !== 0; bits &= bits - 1) {
      const cost = segmentDayCost(day, bits & -bits, remaining, count);
      if (cost < 0) return -1;
      bound = Math.max(bound, cost);
    }
    return bound;
  }

  const dayCost = oneSegment ? weeklyOrFixedDayCost : calendarDayCost;
  const noRemaining = new Int32Array(0);
  /** Exact idle-time and walking cost of a complete schedule, or -1 when it breaks the walking check. */
  function completeCost(): number {
    let total = 0;
    for (let d = 0; d < dayEnd; d += 1) {
      const cost = dayCost(d, noRemaining, 0);
      if (cost < 0) return -1;
      total += cost;
    }
    return total;
  }

  // Per depth: the courses still unassigned after this node's course, and
  // each day's bound before this node's candidate is added.
  const remainingStack: Int32Array[] = [];
  const dayStack: Float64Array[] = [];
  for (let depth = 0; depth <= n; depth += 1) {
    remainingStack.push(new Int32Array(n));
    dayStack.push(new Float64Array(DAY_COUNT));
  }

  // Direct shifts instead of splice: these run for every evaluated child.
  function insertMeetings(candidate: Candidate): void {
    for (const meeting of candidate.meetings) {
      const list = dayLists[meeting.day];
      let index = list.length;
      list.push(meeting);
      while (index > 0 && list[index - 1].start > meeting.start) {
        list[index] = list[index - 1];
        index -= 1;
      }
      list[index] = meeting;
    }
  }

  function removeMeetings(candidate: Candidate): void {
    for (const meeting of candidate.meetings) {
      const list = dayLists[meeting.day];
      let index = list.indexOf(meeting);
      for (; index < list.length - 1; index += 1) list[index] = list[index + 1];
      list.pop();
    }
  }

  function tick(): void {
    budget.nodes += 1;
    if (budget.nodes > budget.maxNodes) throw new BudgetExhausted();
    if ((budget.nodes & 31) === 0 && budget.now() > budget.deadline) throw new BudgetExhausted();
  }

  /**
   * Lower bound on any completion after choosing `candidate` for its course,
   * or Infinity when no completion can be valid or better than `best`.
   * Leaves `scratch` holding the sections still possible.
   */
  function evaluate(candidate: Candidate, alive: Uint32Array, depth: number): number {
    const c = candidate.course;
    const remainingAfter = n - assignedCount - 1;
    for (let j = 0; j < previous.length; j += 1) {
      const matches = same[j] + (previous[j].picks[c].timeSignature === candidate.timeSignature ? 1 : 0);
      if (assignedCount + 1 - matches + remainingAfter < minDifferent) return Number.POSITIVE_INFINITY;
    }
    // Days this candidate does not touch keep the bound computed for the node.
    const nodeDays = dayStack[depth];
    for (let d = 0; d < dayEnd; d += 1) {
      if ((candidate.dayMask & (1 << d)) === 0 && nodeDays[d] < 0) return Number.POSITIVE_INFINITY;
    }
    const conflict = conflicts[candidate.bit];
    for (let w = 0; w < words; w += 1) scratch[w] = alive[w] & ~conflict[w];

    const nextDays = daysUsed | candidate.dayMask;
    const dayPrice = weights.fewerDays * COST_PER_DAY;
    let lowerSelf = selfSum + candidate.self;
    // The most new days any single remaining course must add.
    let mostNewDays = 0;
    const remaining = remainingStack[depth];
    for (let r = 0; r < remainingAfter; r += 1) {
      const course = courses[remaining[r]];
      let first = -1;
      for (let w = course.wordLo; w < course.wordHi && first < 0; w += 1) {
        const value = scratch[w];
        if (value !== 0) first = w * 32 + 31 - Math.clz32(value & -value);
      }
      if (first < 0) return Number.POSITIVE_INFINITY;
      lowerSelf += candidateByBit[first].self;
      if (dayPrice === 0 || mostNewDays === dayEnd) continue;
      let fewestNew = DAY_COUNT + 1;
      for (const group of course.byDayMask) {
        const added = popcount(group.dayMask & ~nextDays);
        if (added >= fewestNew) continue;
        for (let w = course.wordLo; w < course.wordHi; w += 1) {
          if ((group.bits[w] & scratch[w]) !== 0) {
            fewestNew = added;
            break;
          }
        }
        if (fewestNew <= mostNewDays) break;
      }
      if (fewestNew > mostNewDays) mostNewDays = fewestNew;
    }

    let pairs = 0;
    if (pairsMatter) {
      insertMeetings(candidate);
      for (let d = 0; d < dayEnd; d += 1) {
        if ((candidate.dayMask & (1 << d)) === 0) {
          pairs += nodeDays[d];
          continue;
        }
        const cost = dayCost(d, remaining, remainingAfter);
        if (cost < 0) {
          pairs = -1;
          break;
        }
        pairs += cost;
      }
      removeMeetings(candidate);
      if (pairs < 0) return Number.POSITIVE_INFINITY;
    }

    const bound = lowerSelf + dayPrice * (popcount(nextDays) + mostNewDays) + pairs;
    if (best !== null) {
      if (bound > best.cost) return Number.POSITIVE_INFINITY;
      if (bound === best.cost && !canWinTie(candidate)) return Number.POSITIVE_INFINITY;
    }
    return bound;
  }

  /**
   * At bound === best.cost: can some completion still beat `best` under the
   * evidence and key tiers? A completion's evidence is bounded from above
   * by, per course in course order, the assigned section's contribution,
   * the candidate's own on its course, and, for each unassigned course,
   * the most any of its candidates contributes (a static per-course max;
   * ineligible courses contribute 0 for every plan). Sourcing every term
   * from the course index, never from a running accumulator, keeps the
   * bound independent of the search's backtracking bookkeeping; and each
   * term is at least the eventual pick's, so under floating-point rounding
   * the bound is an upper bound on any completion's leaf evidence (float
   * addition is monotone). The comparisons still keep the EVIDENCE_ROUNDING
   * band as cheap insurance; real evidence differences are orders of
   * magnitude above it, so it never spares a genuinely worse branch.
   * When in doubt, do not prune. With no eligible course every plan's
   * evidence is 0, so only the key decides.
   */
  function canWinTie(candidate: Candidate): boolean {
    const target = best!;
    if (eligibleCount > 0) {
      let numerator = 0;
      for (let u = 0; u < n; u += 1) {
        if (u === candidate.course) numerator += candidate.evidence;
        else if (assigned[u] !== null) numerator += assigned[u]!.evidence;
        else numerator += maxEvidenceByCourse[u];
      }
      const evidenceBound = numerator / eligibleCount;
      if (evidenceBound > target.evidence) return true;
      if (evidenceBound < target.evidence - EVIDENCE_ROUNDING) return false;
      return true;
    }
    for (let u = 0; u < n; u += 1) {
      let lowest: string;
      if (u === candidate.course) lowest = candidate.section.id;
      else if (assigned[u] !== null) lowest = assigned[u]!.section.id;
      else {
        const course = courses[u];
        lowest = "\uffff";
        for (let w = course.wordLo; w < course.wordHi; w += 1) {
          let value = scratch[w];
          while (value !== 0) {
            const low = value & -value;
            const id = candidateByBit[w * 32 + 31 - Math.clz32(low)].section.id;
            if (id < lowest) lowest = id;
            value ^= low;
          }
        }
      }
      if (lowest !== target.key[u]) return lowest < target.key[u];
    }
    return false;
  }

  function recordLeaf(): void {
    const picks = assigned as Candidate[];
    const pairs = completeCost();
    if (pairs < 0) return;
    const cost = selfSum + weights.fewerDays * COST_PER_DAY * popcount(daysUsed) + pairs;
    // Mean instructor evidence over the picks in evidence-eligible courses:
    // each eligible pick contributes its precomputed evidence, ineligible
    // courses contribute nothing for any plan (the omit-per-course rule),
    // so missing data is never treated as evidence. With no eligible
    // course the evidence is 0 for every plan and the key decides. The sum
    // runs in course order over candidate.evidence, the same values in the
    // same order canWinTie's bound sums.
    const evidence = eligibleCount > 0 ? picks.reduce((sum, pick) => sum + pick.evidence, 0) / eligibleCount : 0;
    const leaf: Leaf = { picks: [...picks], cost, evidence, key: picks.map((pick) => pick.section.id) };
    options.onLeaf?.(leaf);
    if (options.stopAtFirst) {
      best = leaf;
      throw new FoundOne();
    }
    if (best === null || leafBefore(leaf, best)) best = leaf;
  }

  const unassignedScratch = new Int32Array(n);
  const selfMatters = weights.mornings > 0 || weights.evenings > 0 || weights.rating > 0;
  const minSelfScratch = new Float64Array(n);
  const gainScratch = new Float64Array(n * n);
  const matchScratch = new Float64Array(1 << Math.min(n, 16));

  /**
   * How much the cheapest-section-per-course sum understates the own costs
   * of the unassigned courses, from pairs: two courses' cheapest sections may
   * clash, so a pair costs at least its cheapest compatible combination.
   * Pairs are disjoint (the best matching of courses into pairs, by subset
   * DP), so the gains add. Returns -1 when some pair has no compatible
   * combination at all.
   */
  function pairSelfGains(alive: Uint32Array, all: Int32Array, count: number): number {
    if (count > 16) return 0;
    for (let r = 0; r < count; r += 1) {
      const c = courses[all[r]];
      let first = -1;
      for (let w = c.wordLo; w < c.wordHi && first < 0; w += 1) {
        const value = alive[w];
        if (value !== 0) first = w * 32 + 31 - Math.clz32(value & -value);
      }
      minSelfScratch[r] = candidateByBit[first].self;
    }
    for (let a = 0; a < count; a += 1) {
      const ca = courses[all[a]];
      for (let b = a + 1; b < count; b += 1) {
        const cb = courses[all[b]];
        let bestPair = Number.POSITIVE_INFINITY;
        for (let w = ca.wordLo; w < ca.wordHi; w += 1) {
          let value = alive[w];
          while (value !== 0) {
            const low = value & -value;
            value ^= low;
            const x = candidateByBit[w * 32 + 31 - Math.clz32(low)];
            if (x.self + minSelfScratch[b] >= bestPair) break;
            const conflict = conflicts[x.bit];
            for (let v = cb.wordLo; v < cb.wordHi; v += 1) {
              const open = alive[v] & ~conflict[v];
              if (open !== 0) {
                const y = candidateByBit[v * 32 + 31 - Math.clz32(open & -open)];
                if (x.self + y.self < bestPair) bestPair = x.self + y.self;
                break;
              }
            }
          }
          if (bestPair !== Number.POSITIVE_INFINITY && w + 1 < ca.wordHi) {
            // Later words hold dearer sections; the break above already stops
            // within a word, and this check stops across words.
            const nextValue = alive[w + 1];
            if (nextValue !== 0) {
              const next = candidateByBit[(w + 1) * 32 + 31 - Math.clz32(nextValue & -nextValue)];
              if (next.self + minSelfScratch[b] >= bestPair) break;
            }
          }
        }
        if (bestPair === Number.POSITIVE_INFINITY) return -1;
        gainScratch[a * count + b] = bestPair - minSelfScratch[a] - minSelfScratch[b];
      }
    }
    const full = (1 << count) - 1;
    matchScratch[0] = 0;
    for (let mask = 1; mask <= full; mask += 1) {
      const i = 31 - Math.clz32(mask & -mask);
      const rest = mask & ~(1 << i);
      let value = matchScratch[rest];
      let others = rest;
      while (others !== 0) {
        const j = 31 - Math.clz32(others & -others);
        others &= others - 1;
        const candidate = matchScratch[rest & ~(1 << j)] + gainScratch[i * count + j];
        if (candidate > value) value = candidate;
      }
      matchScratch[mask] = value;
    }
    return matchScratch[full];
  }

  /** True when every section still possible for `u` meets on `day`. */
  function forcedOn(u: number, day: number, alive: Uint32Array): boolean {
    const course = courses[u];
    for (const group of course.byDayMask) {
      if ((group.dayMask & (1 << day)) !== 0) continue;
      for (let w = course.wordLo; w < course.wordHi; w += 1) if ((group.bits[w] & alive[w]) !== 0) return false;
    }
    return true;
  }

  /** Outside-span bound in one segment; a course must meet there in every live candidate. */
  function segmentOutside(day: number, mask: number, all: Int32Array, count: number, alive: Uint32Array): number {
    if (fill === null) return 0;
    let spanStart = -1;
    let spanEnd = -1;
    for (const m of dayLists[day]) {
      if ((m.weeks & mask) === 0) continue;
      if (spanStart < 0) spanStart = m.start;
      spanEnd = m.end;
    }
    if (spanStart < 0) return 0;
    let right = 0;
    let left = 0;
    for (let r = 0; r < count; r += 1) {
      const u = all[r];
      if (!forcedOn(u, day, alive)) continue;
      const c = courses[u];
      let minRight = Number.POSITIVE_INFINITY;
      let minLeft = Number.POSITIVE_INFINITY;
      for (let w = c.wordLo; w < c.wordHi && (minRight > 0 || minLeft > 0); w += 1) {
        let value = alive[w];
        while (value !== 0 && (minRight > 0 || minLeft > 0)) {
          const low = value & -value;
          value ^= low;
          const candidate = candidateByBit[w * 32 + 31 - Math.clz32(low)];
          let extRight = Number.POSITIVE_INFINITY;
          let extLeft = Number.POSITIVE_INFINITY;
          let meets = false;
          for (const m of candidate.meetings) {
            if (m.day !== day || (m.weeks & mask) === 0) continue;
            meets = true;
            let stretchRight = 0;
            let stretchLeft = 0;
            if (m.start >= spanEnd) {
              const cell = timeIndex[spanEnd] * timeCount + timeIndex[m.start];
              let filled = 0;
              for (let q = 0; q < count; q += 1) if (all[q] !== u) filled += fill[all[q]][day][cell];
              stretchRight = Math.max(0, m.start - spanEnd - filled);
            } else if (m.end <= spanStart) {
              const cell = timeIndex[m.end] * timeCount + timeIndex[spanStart];
              let filled = 0;
              for (let q = 0; q < count; q += 1) if (all[q] !== u) filled += fill[all[q]][day][cell];
              stretchLeft = Math.max(0, spanStart - m.end - filled);
            }
            extRight = Math.min(extRight, stretchRight);
            extLeft = Math.min(extLeft, stretchLeft);
          }
          // A live choice without an occurrence means this course need not
          // extend this segment at all, whatever its other choices do.
          if (!meets) {
            minRight = 0;
            minLeft = 0;
            break;
          }
          minRight = Math.min(minRight, extRight);
          minLeft = Math.min(minLeft, extLeft);
        }
      }
      if (minRight !== Number.POSITIVE_INFINITY) right = Math.max(right, minRight);
      if (minLeft !== Number.POSITIVE_INFINITY) left = Math.max(left, minLeft);
    }
    return right + left;
  }

  function calendarNodeDayCost(day: number, all: Int32Array, count: number, alive: Uint32Array): number {
    let bound = mixedDays[day] ? weeklyOrFixedDayCost(day, all, count) : 0;
    if (bound < 0) return -1;
    let bits = dayWeeks[day];
    while (bits !== 0) {
      const mask = mixedDays[day] ? bits & -bits : bits;
      const inside = segmentDayCost(day, mask, all, count);
      if (inside < 0) return -1;
      const outside = segmentOutside(day, mask, all, count, alive);
      // Inside and outside are disjoint only within this segment. Combine
      // them before taking the maximum, never add bounds from other segments.
      bound = Math.max(bound, inside + weights.compact * COST_PER_GAP_MINUTE * outside);
      if (!mixedDays[day]) break;
      bits &= bits - 1;
    }
    return bound;
  }

  /**
   * A lower bound shared by every child of a node (or -1 when the node is
   * dead), used when idle time is weighted. Besides the per-child terms it
   * counts idle time outside each day's current span: when a course must
   * meet on a day and every section it has left meets after (or before) the
   * classes already there, the stretch between them is idle except for what
   * the other unassigned courses could fill. Only the largest such stretch on
   * each side counts, because one stretch can cover another. Dated requests
   * use calendarNodeDayCost to keep the inside and outside bounds in the
   * same segment before taking the maximum.
   */
  function nodeFloor(alive: Uint32Array, course: number, remaining: Int32Array, remainingCount: number): number {
    const all = unassignedScratch;
    all[0] = course;
    for (let r = 0; r < remainingCount; r += 1) all[r + 1] = remaining[r];
    const count = remainingCount + 1;
    const dayPrice = weights.fewerDays * COST_PER_DAY;
    let self = selfSum;
    let mostNewDays = 0;
    for (let r = 0; r < count; r += 1) {
      const c = courses[all[r]];
      let first = -1;
      for (let w = c.wordLo; w < c.wordHi && first < 0; w += 1) {
        const value = alive[w];
        if (value !== 0) first = w * 32 + 31 - Math.clz32(value & -value);
      }
      if (first < 0) return -1;
      self += candidateByBit[first].self;
      if (dayPrice === 0) continue;
      let fewestNew = DAY_COUNT + 1;
      for (const group of c.byDayMask) {
        const added = popcount(group.dayMask & ~daysUsed);
        if (added >= fewestNew) continue;
        for (let w = c.wordLo; w < c.wordHi; w += 1) {
          if ((group.bits[w] & alive[w]) !== 0) {
            fewestNew = added;
            break;
          }
        }
      }
      if (fewestNew > mostNewDays) mostNewDays = fewestNew;
    }
    if (selfMatters && count >= 2) {
      const pairGain = pairSelfGains(alive, all, count);
      if (pairGain < 0) return -1;
      self += pairGain;
    }
    let pairs = 0;
    let outside = 0;
    for (let d = 0; d < dayEnd && weights.compact > 0; d += 1) {
      if (!oneSegment) {
        const dated = calendarNodeDayCost(d, all, count, alive);
        if (dated < 0) return -1;
        pairs += dated;
        continue;
      }
      const inside = dayCost(d, all, count);
      if (inside < 0) return -1;
      pairs += inside;
      const list = dayLists[d];
      if (list.length === 0 || fill === null || !oneSegment) continue;
      const spanStart = list[0].start;
      const spanEnd = list[list.length - 1].end;
      let right = 0;
      let left = 0;
      for (let r = 0; r < count; r += 1) {
        const u = all[r];
        if (!forcedOn(u, d, alive)) continue;
        const c = courses[u];
        let minRight = Number.POSITIVE_INFINITY;
        let minLeft = Number.POSITIVE_INFINITY;
        for (let w = c.wordLo; w < c.wordHi && (minRight > 0 || minLeft > 0); w += 1) {
          let value = alive[w];
          while (value !== 0 && (minRight > 0 || minLeft > 0)) {
            const low = value & -value;
            value ^= low;
            const candidate = candidateByBit[w * 32 + 31 - Math.clz32(low)];
            let extRight = Number.POSITIVE_INFINITY;
            let extLeft = Number.POSITIVE_INFINITY;
            for (const m of candidate.meetings) {
              if (m.day !== d) continue;
              let stretchRight = 0;
              let stretchLeft = 0;
              if (m.start >= spanEnd) {
                const cell = timeIndex[spanEnd] * timeCount + timeIndex[m.start];
                let filled = 0;
                for (let q = 0; q < count; q += 1) if (all[q] !== u) filled += fill[all[q]][d][cell];
                stretchRight = Math.max(0, m.start - spanEnd - filled);
              } else if (m.end <= spanStart) {
                const cell = timeIndex[m.end] * timeCount + timeIndex[spanStart];
                let filled = 0;
                for (let q = 0; q < count; q += 1) if (all[q] !== u) filled += fill[all[q]][d][cell];
                stretchLeft = Math.max(0, spanStart - m.end - filled);
              }
              if (stretchRight < extRight) extRight = stretchRight;
              if (stretchLeft < extLeft) extLeft = stretchLeft;
            }
            if (extRight < minRight) minRight = extRight;
            if (extLeft < minLeft) minLeft = extLeft;
          }
        }
        if (minRight !== Number.POSITIVE_INFINITY && minRight > right) right = minRight;
        if (minLeft !== Number.POSITIVE_INFINITY && minLeft > left) left = minLeft;
      }
      outside += right + left;
    }
    return self + dayPrice * (popcount(daysUsed) + mostNewDays) + pairs + weights.compact * COST_PER_GAP_MINUTE * outside;
  }

  function dfs(depth: number): void {
    tick();
    if (depth === n) {
      recordLeaf();
      return;
    }
    const alive = aliveStack[depth];
    let course = -1;
    let fewest = Number.POSITIVE_INFINITY;
    for (let u = 0; u < n; u += 1) {
      if (assigned[u] !== null) continue;
      let count = 0;
      for (let w = courses[u].wordLo; w < courses[u].wordHi; w += 1) count += popcount(alive[w]);
      if (count === 0) return;
      if (count < fewest) {
        fewest = count;
        course = u;
      }
    }

    const remaining = remainingStack[depth];
    let remainingCount = 0;
    for (let u = 0; u < n; u += 1) if (u !== course && assigned[u] === null) remaining[remainingCount++] = u;
    const nodeDays = dayStack[depth];
    for (let d = 0; d < dayEnd; d += 1) nodeDays[d] = pairsMatter ? dayCost(d, remaining, remainingCount) : 0;
    const floor = weights.compact > 0 || selfMatters ? nodeFloor(alive, course, remaining, remainingCount) : 0;
    if (floor < 0 || (best !== null && floor > best.cost)) return;

    const children: Array<{ bound: number; candidate: Candidate }> = [];
    const { wordLo, wordHi } = courses[course];
    for (let w = wordLo; w < wordHi; w += 1) {
      let value = alive[w];
      while (value !== 0) {
        const low = value & -value;
        value ^= low;
        const candidate = candidateByBit[w * 32 + 31 - Math.clz32(low)];
        const bound = evaluate(candidate, alive, depth);
        if (bound !== Number.POSITIVE_INFINITY) children.push({ bound: Math.max(bound, floor), candidate });
      }
    }
    // Most promising first; equal bounds keep candidate order (self cost, then id).
    children.sort((a, b) => a.bound - b.bound || a.candidate.bit - b.candidate.bit);

    for (const child of children) {
      const candidate = child.candidate;
      if (best !== null && child.bound > best.cost) break;
      if (best !== null && child.bound === best.cost) {
        // `best` may have improved since this child was evaluated.
        if (evaluate(candidate, alive, depth) === Number.POSITIVE_INFINITY) continue;
      }
      const next = aliveStack[depth + 1];
      const conflict = conflicts[candidate.bit];
      for (let w = 0; w < words; w += 1) next[w] = alive[w] & ~conflict[w];
      assigned[candidate.course] = candidate;
      selfSum += candidate.self;
      const previousDays = daysUsed;
      daysUsed |= candidate.dayMask;
      insertMeetings(candidate);
      for (let j = 0; j < previous.length; j += 1) {
        if (previous[j].picks[candidate.course].timeSignature === candidate.timeSignature) same[j] += 1;
      }
      assignedCount += 1;

      dfs(depth + 1);

      assignedCount -= 1;
      for (let j = 0; j < previous.length; j += 1) {
        if (previous[j].picks[candidate.course].timeSignature === candidate.timeSignature) same[j] -= 1;
      }
      removeMeetings(candidate);
      daysUsed = previousDays;
      selfSum -= candidate.self;
      assigned[candidate.course] = null;
    }
  }

  try {
    dfs(0);
  } catch (signal) {
    if (signal instanceof FoundOne) return { best, complete: true };
    if (signal instanceof BudgetExhausted) return { best, complete: false };
    throw signal;
  }
  return { best, complete: true };
}

/** True, false, or null when the budget ran out before an answer. */
export function isFeasible(prepared: Prepared, budget: Budget): boolean | null {
  const outcome = search(prepared, budget, { previous: [], minDifferent: 0, stopAtFirst: true, incumbent: null });
  if (outcome.best !== null) return true;
  return outcome.complete ? false : null;
}

/** How many courses two schedules place at different meeting times. */
export function differingCourses(a: Leaf, b: Leaf): number {
  let count = 0;
  for (let i = 0; i < a.picks.length; i += 1) {
    if (a.picks[i].timeSignature !== b.picks[i].timeSignature) count += 1;
  }
  return count;
}
