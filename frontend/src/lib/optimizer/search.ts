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
 * far, or equal to it but unable to win the id tie-break, is skipped. The
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
 */

import { COST_PER_DAY, COST_PER_GAP_MINUTE, COST_PER_WALK_SECOND, UNKNOWN_WALK_SECONDS } from "./score";
import type { Candidate, Prepared, PreparedMeeting } from "./prepare";

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

/** Strict order: lower cost first, then the lower tie-break key. */
export function leafBefore(a: Pick<Leaf, "cost" | "key">, b: Pick<Leaf, "cost" | "key">): boolean {
  return a.cost < b.cost || (a.cost === b.cost && compareKeys(a.key, b.key) < 0);
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
  const dayLists: PreparedMeeting[][] = [[], [], [], [], []];
  let daysUsed = 0;
  let selfSum = 0;
  let assignedCount = 0;
  const previous = options.previous;
  const same = new Int32Array(previous.length);
  const minDifferent = options.minDifferent;

  const walkOf = (from: number, to: number): number | null => {
    if (from >= 0 && from === to) return 0;
    if (from < 0 || to < 0) return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };

  const { times, timeIndex, fill, walkFloor } = prepared;
  const floorStride = buildingCount + 1;
  const timeCount = times.length;
  const pairsMatter = weights.compact > 0 || weights.walking > 0 || bufferSeconds !== null;

  /**
   * Lower bound on one day's idle-time and walking cost, given the courses
   * still to assign (`remaining`), or -1 when a pair breaks the walking check
   * for certain. A break between consecutive chosen classes can only shrink
   * by what the remaining courses could put inside it: at most one class per
   * course, no longer than the longest of that course's classes that fits
   * (the `fill` table). A break nothing can enter keeps its idle minutes and
   * its walk in every completion.
   */
  function dayCost(day: number, remaining: Int32Array, remainingCount: number): number {
    const list = dayLists[day];
    let gap = 0;
    let walkCost = 0;
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const next = list[i];
      const window = next.start - prev.end;
      const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
      let filled = 0;
      for (let r = 0; r < remainingCount && filled < window; r += 1) filled += fill[remaining[r]][day][cell];
      if (filled > 0) {
        if (filled < window) gap += window - filled;
        if (!(prev.building >= 0 && prev.building === next.building)) {
          walkCost += walkFloor[(prev.building < 0 ? buildingCount : prev.building) * floorStride + (next.building < 0 ? buildingCount : next.building)];
        }
        continue;
      }
      gap += window;
      if (prev.building >= 0 && prev.building === next.building) continue;
      const seconds = walkOf(prev.building, next.building);
      walkCost += seconds ?? UNKNOWN_WALK_SECONDS;
      if (bufferSeconds !== null && window * 60 < (seconds ?? UNKNOWN_WALK_SECONDS) + bufferSeconds) return -1;
    }
    return weights.compact * COST_PER_GAP_MINUTE * gap + weights.walking * COST_PER_WALK_SECOND * walkCost;
  }

  const noRemaining = new Int32Array(0);
  /** Exact idle-time and walking cost of a complete schedule, or -1 when it breaks the walking check. */
  function completeCost(): number {
    let total = 0;
    for (let d = 0; d < 5; d += 1) {
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
    dayStack.push(new Float64Array(5));
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
    for (let d = 0; d < 5; d += 1) {
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
      if (dayPrice === 0 || mostNewDays === 5) continue;
      let fewestNew = 6;
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
      for (let d = 0; d < 5; d += 1) {
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

  /** At equal cost, can some completion still have a lower tie-break key than `best`? */
  function canWinTie(candidate: Candidate): boolean {
    const target = best!.key;
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
      if (lowest !== target[u]) return lowest < target[u];
    }
    return false;
  }

  function recordLeaf(): void {
    const picks = assigned as Candidate[];
    const pairs = completeCost();
    if (pairs < 0) return;
    const cost = selfSum + weights.fewerDays * COST_PER_DAY * popcount(daysUsed) + pairs;
    const leaf: Leaf = { picks: [...picks], cost, key: picks.map((pick) => pick.section.id) };
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

  /**
   * A lower bound shared by every child of a node (or -1 when the node is
   * dead), used when idle time is weighted. Besides the per-child terms it
   * counts idle time outside each day's current span: when a course must
   * meet on a day and every section it has left meets after (or before) the
   * classes already there, the stretch between them is idle except for what
   * the other unassigned courses could fill. Only the largest such stretch on
   * each side counts, because one stretch can cover another.
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
      let fewestNew = 6;
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
    for (let d = 0; d < 5 && weights.compact > 0; d += 1) {
      const inside = dayCost(d, all, count);
      if (inside < 0) return -1;
      pairs += inside;
      const list = dayLists[d];
      if (list.length === 0) continue;
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
    for (let d = 0; d < 5; d += 1) nodeDays[d] = pairsMatter ? dayCost(d, remaining, remainingCount) : 0;
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
