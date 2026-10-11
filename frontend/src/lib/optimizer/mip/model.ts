/**
 * Meeting-level exact MIP encoding of the frozen round-1 scheduling contract
 * (see ../types.ts). Costs are never re-derived for OUTPUTS: the official
 * breakdown of every returned schedule comes from scorer's computeBreakdown.
 * The model's self-cost terms mirror scorer's term definitions (including the
 * imported default anchors) solely so the linearization can be cross-checked
 * against the scorer in tests.
 *
 * SOLVER (documented per the round plan): `highs` 1.15.3 — HiGHS compiled to
 * WebAssembly (lovasoa/highs-js, MIT). Chosen because it solves
 * mixed-integer programs natively under bun with TypeScript types and zero
 * native build steps, exposes the HiGHS option passthrough this variant
 * needs for budgeted deterministic solves (time_limit, mip_rel_gap,
 * random_seed), and ships dual CJS/ESM entries with a wasm asset bundlers
 * can resolve for the browser. It is the only dependency this variant adds.
 *
 * VARIABLES (all binary):
 * - x_k: candidate section k is chosen. Candidates come from scorer's
 *   pruneCandidates (requested courses only, exclusions removed, id-sorted
 *   per course), minus sections violating a unary hard constraint, minus
 *   sections whose own meetings overlap on a day (such a section can never
 *   appear in a legal schedule). A locked section skips neither filter; if
 *   it fails either, the request is forced-infeasible (locked sections are
 *   always chosen) and buildMipModel reports { ok: false }.
 * - z_p for same-day ordered meeting pairs (a before b, a.end <= b.start):
 *   1 iff both endpoints are chosen AND no other chosen meeting sits
 *   between them, i.e. the pair is CONSECUTIVE in the chosen schedule. The
 *   scorer charges gap and walking costs only on consecutive pairs of the
 *   chosen meetings sorted by start, so the linearization subtracts the
 *   between-set:
 *     z_ij >= x_i + x_j - 1 - sum(x_k in between(i, j))
 *   where between(i, j) are the candidates with a meeting m on that day
 *   with i.end <= m.start and m.end <= j.start (other than the endpoint
 *   meetings). For checker-legal schedules every chosen meeting between i
 *   and j is non-overlapping with both endpoints (overlaps are cut by their
 *   own rows), so this is exact: with no between candidate chosen the pair
 *   is consecutive and pays its gap/walk; with one chosen the charge moves
 *   to the two shorter consecutive pairs instead. The naive
 *   `z >= x_i + x_j - 1` form overcharges exactly these schedules.
 * - d_day: at least one chosen section has a meeting on that day.
 *
 * HARD CONSTRAINTS:
 * - exactly one candidate per requested course (sum x = 1);
 * - no two chosen meetings overlap (same day, half-open) — pairwise rows;
 * - credits: sum credits_k x_k <= maxCredits;
 * - minTransferMinutes: for same-day ordered pairs (a before b) in
 *   DIFFERENT buildings with gap = b.start - a.end < minTransferMinutes:
 *     x_a + x_b - sum(x_k in between(a, b)) <= 1
 *   (same between-set as z; same-building pairs are exempt per the
 *   contract; walking time is SOFT and never appears in a hard row);
 * - locked sections are pinned via an `x = 1` row.
 *
 * OBJECTIVE (minimize; mirrors the pinned cost formula):
 * - self term per section: early-start + late-end minutes over its
 *   meetings, minus rating/GPA rewards (missing values contribute 0);
 * - per consecutive pair: perGapMinute * gap plus, for different buildings,
 *   perWalkingSecond * seconds when the walk is known, or
 *   perUnknownWalking when unknown (never treated as 0 or free);
 * - per day: perDayOnCampus * d_day.
 *
 * Determinism: no randomness, no wall-clock reads (the budget clock lives
 * in mip-optimizer.ts), and fixed iteration orders derived from the request
 * (courses in requested order, sections id-sorted, days in weekDays order,
 * meetings sorted by start/end/candidate).
 */
import { weekDays, type WeekDay } from "@/lib/types";
import {
  DEFAULT_EARLY_START_ANCHOR_MINUTES,
  DEFAULT_LATE_END_ANCHOR_MINUTES,
  type OptimizeRequest,
  type OptimizerMeeting,
  type OptimizerSection,
} from "../types";
import { pruneCandidates } from "../scorer";
import type { LpModelData, LpRow } from "./lp";

/** True when the section cannot appear in ANY legal schedule on its own. */
export function sectionSelfOverlap(section: OptimizerSection): boolean {
  for (let i = 1; i < section.meetings.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = section.meetings[i];
      const b = section.meetings[j];
      if (a.day === b.day && Math.max(a.start, b.start) < Math.min(a.end, b.end)) return true;
    }
  }
  return false;
}

/**
 * Unary hard-constraint violation (earliestStart, latestEnd, daysOff,
 * blockedTimeRanges). Mirrors the checker's per-section rules; credits and
 * pairwise rules are enforced separately.
 */
export function sectionViolatesUnary(req: OptimizeRequest, section: OptimizerSection): boolean {
  const hard = req.hardConstraints;
  for (const meeting of section.meetings) {
    if (hard.earliestStart !== undefined && meeting.start < hard.earliestStart) return true;
    if (hard.latestEnd !== undefined && meeting.end > hard.latestEnd) return true;
    if (hard.daysOff !== undefined && hard.daysOff.includes(meeting.day)) return true;
    for (const blocked of hard.blockedTimeRanges ?? []) {
      if (blocked.day === meeting.day && meeting.start < blocked.end && blocked.start < meeting.end) return true;
    }
  }
  return false;
}

/** The model's self-cost coefficient for a section (mirror of scorer's per-section terms). */
export function sectionSelfCost(req: OptimizeRequest, section: OptimizerSection): number {
  const weights = req.softWeights;
  const earlyAnchor = req.earlyStartAnchorMinutes ?? DEFAULT_EARLY_START_ANCHOR_MINUTES;
  const lateAnchor = req.lateEndAnchorMinutes ?? DEFAULT_LATE_END_ANCHOR_MINUTES;
  let cost = 0;
  for (const meeting of section.meetings) {
    cost += weights.perEarlyStartMinute * Math.max(0, earlyAnchor - meeting.start);
    cost += weights.perLateEndMinute * Math.max(0, meeting.end - lateAnchor);
  }
  if (section.instructorRating !== undefined) cost -= weights.perRatingPoint * section.instructorRating;
  if (section.historicalGpa !== undefined) cost -= weights.perGpaPoint * section.historicalGpa;
  return cost;
}

/** A candidate meeting pinned to its candidate index. */
interface MeetingRef {
  readonly day: WeekDay;
  readonly start: number;
  readonly end: number;
  readonly buildingId: string;
  readonly candidate: number;
  readonly course: string;
}

/** Consecutive-pair term: active iff both endpoints are chosen and no between candidate is. */
export interface MipZPair {
  readonly i: number;
  readonly j: number;
  readonly cost: number;
  readonly between: readonly number[];
}

export interface MipModel {
  readonly data: LpModelData;
  /** Candidate sections in column order (x0..xn-1). */
  readonly candidates: readonly OptimizerSection[];
  /** Structured consecutive-pair terms (used by evaluateModelObjective). */
  readonly zPairs: readonly MipZPair[];
  /** Per-day on-campus groups: candidate indexes with a meeting that day. */
  readonly dayGroups: ReadonlyArray<{ readonly members: readonly number[] }>;
}

export type BuildOutcome = { readonly ok: true; readonly model: MipModel } | { readonly ok: false };

export function buildMipModel(req: OptimizeRequest): BuildOutcome {
  const locked = new Set(req.lockedSectionIds);
  const groups = pruneCandidates(req);
  const candidates: OptimizerSection[] = [];
  const courseRanges: Array<{ readonly first: number; readonly last: number }> = [];
  for (const group of groups) {
    const first = candidates.length;
    for (const section of group.sections) {
      const broken = sectionViolatesUnary(req, section) || sectionSelfOverlap(section);
      if (locked.has(section.id)) {
        // Locked sections are always chosen; if they cannot legally be
        // chosen, the request is infeasible.
        if (broken) return { ok: false };
      } else if (broken) {
        continue;
      }
      candidates.push(section);
    }
    // A requested course with no remaining candidate is infeasible.
    if (candidates.length === first) return { ok: false };
    courseRanges.push({ first, last: candidates.length - 1 });
  }

  const columnNames: string[] = [];
  const columnObjectives: number[] = [];
  const rows: LpRow[] = [];
  const addRow = (name: string, terms: Array<readonly [number, number]>, sense: LpRow["sense"], rhs: number): void => {
    rows.push({ name, terms, sense, rhs });
  };

  candidates.forEach((section, index) => {
    columnNames.push(`x${index}`);
    columnObjectives.push(sectionSelfCost(req, section));
  });

  // Exactly one candidate per requested course.
  courseRanges.forEach((range, courseIndex) => {
    const terms: Array<readonly [number, number]> = [];
    for (let i = range.first; i <= range.last; i++) terms.push([1, i]);
    addRow(`pick${courseIndex}`, terms, "=", 1);
  });

  // Locked sections are pinned to 1.
  candidates.forEach((section, index) => {
    if (locked.has(section.id)) addRow(`lock${index}`, [[1, index]], "=", 1);
  });

  // Credits cap.
  const maxCredits = req.hardConstraints.maxCredits;
  if (maxCredits !== undefined) {
    addRow(
      "credits",
      candidates.map((section, index) => [section.credits, index] as const),
      "<=",
      maxCredits,
    );
  }

  // Candidate meetings grouped by day, in deterministic sorted order.
  const byDay = new Map<WeekDay, MeetingRef[]>();
  for (const day of weekDays) byDay.set(day, []);
  candidates.forEach((section, index) => {
    for (const meeting of section.meetings) {
      const ref: MeetingRef = {
        day: meeting.day,
        start: meeting.start,
        end: meeting.end,
        buildingId: meeting.buildingId,
        candidate: index,
        course: section.courseCode,
      };
      const list = byDay.get(meeting.day);
      if (list) list.push(ref);
      else byDay.set(meeting.day, [ref]);
    }
  });
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end || a.candidate - b.candidate);
  }

  // Pairwise overlap rows over same-day meetings (half-open). Rows for
  // same-course pairs are skipped: the exactly-one-per-course row already
  // forbids choosing both, so the overlap row can never bind.
  let rowCounter = 0;
  const overlapSeen = new Set<string>();
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
        const a = list[i];
        const b = list[j];
        if (a.candidate === b.candidate) continue; // self-overlap already pruned
        if (a.course === b.course) continue; // exactly-one row covers this pair
        const key = `${Math.min(a.candidate, b.candidate)}:${Math.max(a.candidate, b.candidate)}`;
        if (overlapSeen.has(key)) continue;
        overlapSeen.add(key);
        addRow(`ov${rowCounter++}`, [[1, a.candidate], [1, b.candidate]], "<=", 1);
      }
    }
  }

  // Between-sets, hard transfer rows, and consecutive-pair cost terms.
  const minTransfer = req.hardConstraints.minTransferMinutes;
  const weights = req.softWeights;
  const walkCache = new Map<string, number | null>();
  const walkSeconds = (from: string, to: string): number | null => {
    const key = `${from}\u0000${to}`;
    const cached = walkCache.get(key);
    if (cached !== undefined) return cached;
    const seconds = req.walkingTime(from, to).seconds;
    walkCache.set(key, seconds);
    return seconds;
  };
  const zPairs: MipZPair[] = [];
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (b.start < a.end) continue; // overlapping: already cut above
        // Same-course pairs are skipped outright: the exactly-one-per-course
        // row means two sections of one course can never be chosen together,
        // so neither a transfer row nor a cost term can ever activate.
        if (a.course === b.course) continue;
        const gap = b.start - a.end;
        // Between-set: candidates with a meeting strictly inside the window
        // (non-strict on both ends so back-to-back chains count, matching
        // the checker's consecutiveness), endpoint meetings excluded.
        const between: number[] = [];
        for (const meeting of list) {
          if (meeting === a || meeting === b) continue;
          if (meeting.course === a.course || meeting.course === b.course) continue;
          if (meeting.start >= a.end && meeting.end <= b.start && !between.includes(meeting.candidate)) {
            between.push(meeting.candidate);
          }
        }
        let zCost = weights.perGapMinute * gap;
        if (a.buildingId !== b.buildingId) {
          const seconds = walkSeconds(a.buildingId, b.buildingId);
          zCost += seconds === null ? weights.perUnknownWalking : weights.perWalkingSecond * seconds;
          if (minTransfer !== undefined && gap < minTransfer) {
            const terms: Array<readonly [number, number]> = [
              [1, a.candidate],
              [1, b.candidate],
              ...between.map((k) => [-1, k] as const),
            ];
            addRow(`tr${rowCounter++}`, terms, "<=", 1);
          }
        }
        if (zCost !== 0) {
          const zColumn = columnNames.length;
          columnNames.push(`z${zPairs.length}`);
          columnObjectives.push(zCost);
          // Only the lower bound is needed: z carries a positive cost, so
          // the solver pins it to exactly x_i + x_j - 1 - sum(between)
          // whenever that is positive, and 0 otherwise. Upper rows
          // (z <= x_i, z <= x_j) would be redundant.
          const terms: Array<readonly [number, number]> = [
            [1, zColumn],
            [-1, a.candidate],
            [-1, b.candidate],
            ...between.map((k) => [1, k] as const),
          ];
          addRow(`zb${rowCounter++}`, terms, ">=", -1);
          zPairs.push({ i: a.candidate, j: b.candidate, cost: zCost, between });
        }
      }
    }
  }

  // Day-on-campus binaries (skipped entirely when the weight is 0).
  const dayGroups: Array<{ members: number[] }> = [];
  if (weights.perDayOnCampus !== 0) {
    let dayIndex = 0;
    for (const list of byDay.values()) {
      if (list.length === 0) continue;
      const dColumn = columnNames.length;
      columnNames.push(`d${dayIndex}`);
      columnObjectives.push(weights.perDayOnCampus);
      dayIndex += 1;
      const members = [...new Set(list.map((meeting) => meeting.candidate))];
      for (const member of members) addRow(`dd${rowCounter++}`, [[1, dColumn], [-1, member]], ">=", 0);
      dayGroups.push({ members });
    }
  }

  const data: LpModelData = {
    columns: columnNames.map((name, index) => ({ name, objective: columnObjectives[index] })),
    rows,
  };
  return { ok: true, model: { data, candidates, zPairs, dayGroups } };
}

/** Evaluate the MODEL's linearized objective for a chosen set (test cross-check against the scorer). */
export function evaluateModelObjective(req: OptimizeRequest, chosen: OptimizerSection[]): number {
  const outcome = buildMipModel(req);
  if (!outcome.ok) throw new Error("evaluateModelObjective: the request does not build a model (infeasible)");
  const model = outcome.model;
  const indexById = new Map(model.candidates.map((section, index) => [section.id, index]));
  const chosenIndexes = new Set<number>();
  for (const section of chosen) {
    const index = indexById.get(section.id);
    if (index === undefined) throw new Error(`evaluateModelObjective: section ${section.id} is not a candidate`);
    chosenIndexes.add(index);
  }
  let total = 0;
  for (let index = 0; index < model.candidates.length; index++) {
    if (chosenIndexes.has(index)) total += model.data.columns[index].objective;
  }
  for (const pair of model.zPairs) {
    if (!chosenIndexes.has(pair.i) || !chosenIndexes.has(pair.j)) continue;
    if (pair.between.some((k) => chosenIndexes.has(k))) continue;
    total += pair.cost;
  }
  for (const group of model.dayGroups) {
    if (group.members.some((k) => chosenIndexes.has(k))) total += req.softWeights.perDayOnCampus;
  }
  return total;
}

/** Contract problems of a concrete chosen set (safety net for time-limited incumbents). */
export function chosenSetProblems(req: OptimizeRequest, chosen: OptimizerSection[]): string[] {
  const problems: string[] = [];
  const perCourse = new Map<string, number>();
  for (const section of chosen) {
    perCourse.set(section.courseCode, (perCourse.get(section.courseCode) ?? 0) + 1);
  }
  for (const code of req.requestedCourseCodes) {
    if (perCourse.get(code) !== 1) problems.push(`course ${code} is not chosen exactly once`);
  }
  const maxCredits = req.hardConstraints.maxCredits;
  if (maxCredits !== undefined && chosen.reduce((sum, section) => sum + section.credits, 0) > maxCredits) {
    problems.push("chosen credits exceed maxCredits");
  }
  for (const section of chosen) {
    if (sectionViolatesUnary(req, section)) problems.push(`section ${section.id} violates a unary constraint`);
    if (sectionSelfOverlap(section)) problems.push(`section ${section.id} overlaps itself`);
  }
  const meetings: Array<OptimizerMeeting & { sectionId: string }> = chosen.flatMap((section) =>
    section.meetings.map((meeting) => ({ ...meeting, sectionId: section.id })),
  );
  for (let i = 1; i < meetings.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = meetings[i];
      const b = meetings[j];
      if (a.day === b.day && Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
        problems.push(`meetings of ${a.sectionId} and ${b.sectionId} overlap on ${a.day}`);
      }
    }
  }
  const minTransfer = req.hardConstraints.minTransferMinutes;
  if (minTransfer !== undefined) {
    const byDay = new Map<WeekDay, Array<OptimizerMeeting & { sectionId: string }>>();
    for (const meeting of meetings) {
      const list = byDay.get(meeting.day);
      if (list) list.push(meeting);
      else byDay.set(meeting.day, [meeting]);
    }
    for (const [day, list] of byDay) {
      list.sort((a, b) => a.start - b.start || a.end - b.end || (a.sectionId < b.sectionId ? -1 : 1));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const next = list[i];
        if (prev.buildingId !== next.buildingId && next.start - prev.end < minTransfer) {
          problems.push(`transfer from ${prev.sectionId} to ${next.sectionId} on ${day} is too short`);
        }
      }
    }
  }
  return problems;
}
