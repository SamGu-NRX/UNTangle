// Generated from optimize.worker.ts by `bun tests/optimizer/build-worker.ts --write`. Do not edit.
/* eslint-disable */
// src/lib/optimizer/types.ts
var OPT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
var MAX_WEIGHT = 4;

class OptimizerInputError extends Error {
  constructor(message) {
    super(`optimizer: ${message}`);
    this.name = "OptimizerInputError";
  }
}

// src/lib/optimizer/score.ts
var COST_PER_DAY = 3600;
var COST_PER_GAP_MINUTE = 60;
var COST_PER_WALK_SECOND = 1;
var COST_PER_LEAN_MINUTE = 20;
var COST_PER_RATING_TENTH = 180;
var UNKNOWN_WALK_SECONDS = 600;
var MORNING_ANCHOR = 7 * 60;
var EVENING_ANCHOR = 22 * 60;
var DEFAULT_RATING_TENTHS = 30;
function ratingTenths(rating) {
  if (rating === null || !Number.isFinite(rating))
    return null;
  return Math.max(0, Math.min(50, Math.round(rating * 10)));
}
function neutralRatingTenths(sections) {
  const present = sections.map((section) => ratingTenths(section.rating)).filter((value) => value !== null);
  if (present.length === 0)
    return DEFAULT_RATING_TENTHS;
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
}
function selfCost(section, weights, neutralTenths) {
  const count = section.meetings.length;
  const meanStart = Math.round(section.meetings.reduce((sum, m) => sum + m.start, 0) / count);
  const meanEnd = Math.round(section.meetings.reduce((sum, m) => sum + m.end, 0) / count);
  const lean = weights.mornings * Math.max(0, meanStart - MORNING_ANCHOR) + weights.evenings * Math.max(0, EVENING_ANCHOR - meanEnd);
  const tenths = ratingTenths(section.rating) ?? neutralTenths;
  return lean * COST_PER_LEAN_MINUTE + weights.rating * (50 - tenths) * COST_PER_RATING_TENTH;
}
function sameBuilding(a, b) {
  return a !== null && b !== null && a === b;
}
function walkSeconds(walkingTime, from, to) {
  if (sameBuilding(from, to))
    return 0;
  if (from === null || to === null)
    return null;
  const leg = walkingTime(from, to);
  if (leg.source === "unknown" || leg.seconds === null)
    return null;
  if (!Number.isFinite(leg.seconds) || leg.seconds < 0) {
    throw new OptimizerInputError(`walking time ${from} -> ${to} is ${leg.seconds}, not a non-negative number of seconds`);
  }
  return Math.round(leg.seconds);
}
function transferFits(prev, next, walk, bufferMinutes) {
  const needed = (walk ?? UNKNOWN_WALK_SECONDS) + bufferMinutes * 60;
  return (next.start - prev.end) * 60 >= needed;
}
function meetingsByDay(sections) {
  const byDay = new Map;
  for (const section of sections) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day) ?? [];
      list.push({ ...meeting, sectionId: section.id });
      byDay.set(meeting.day, list);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return byDay;
}
function scoreSchedule(input) {
  const { sections, weights, walkingTime } = input;
  const byDay = meetingsByDay(sections);
  let gapMinutes = 0;
  let knownWalk = 0;
  let unknownWalks = 0;
  for (const day of OPT_DAYS) {
    const list = byDay.get(day);
    if (!list)
      continue;
    for (let i = 1;i < list.length; i += 1) {
      gapMinutes += Math.max(0, list[i].start - list[i - 1].end);
      if (sameBuilding(list[i - 1].buildingId, list[i].buildingId))
        continue;
      const walk = walkSeconds(walkingTime, list[i - 1].buildingId, list[i].buildingId);
      if (walk === null)
        unknownWalks += 1;
      else
        knownWalk += walk;
    }
  }
  const meetings = sections.flatMap((section) => section.meetings);
  const ratings = sections.map((section) => ratingTenths(section.rating)).filter((value) => value !== null);
  const credits = sections.reduce((sum, section) => sum + (input.creditsByCourse[section.courseCode] ?? 0), 0);
  const breakdown = {
    daysOnCampus: byDay.size,
    gapMinutes,
    walkSeconds: knownWalk,
    unknownWalks,
    earliestStart: meetings.length > 0 ? Math.min(...meetings.map((m) => m.start)) : null,
    latestEnd: meetings.length > 0 ? Math.max(...meetings.map((m) => m.end)) : null,
    credits,
    averageRating: ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) / 10 : null
  };
  let cost = weights.fewerDays * COST_PER_DAY * breakdown.daysOnCampus + weights.compact * COST_PER_GAP_MINUTE * gapMinutes + weights.walking * COST_PER_WALK_SECOND * (knownWalk + UNKNOWN_WALK_SECONDS * unknownWalks);
  for (const section of sections) {
    cost += selfCost(section, weights, input.neutralRatingByCourse[section.courseCode] ?? DEFAULT_RATING_TENTHS);
  }
  return { cost, breakdown };
}

// src/lib/optimizer/prepare.ts
var DAY_INDEX = new Map(OPT_DAYS.map((day, index) => [day, index]));
function isInteger(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function validateRequest(request) {
  const codes = new Set;
  const sectionIds = new Map;
  for (const course of request.courses) {
    if (codes.has(course.code))
      throw new OptimizerInputError(`course ${course.code} is listed twice`);
    codes.add(course.code);
    if (!Number.isFinite(course.credits) || course.credits < 0) {
      throw new OptimizerInputError(`course ${course.code} has invalid credits ${course.credits}`);
    }
    for (const section of course.sections) {
      if (sectionIds.has(section.id))
        throw new OptimizerInputError(`section ${section.id} is listed twice`);
      sectionIds.set(section.id, course.code);
      if (section.courseCode !== course.code) {
        throw new OptimizerInputError(`section ${section.id} belongs to ${section.courseCode}, listed under ${course.code}`);
      }
      if (section.meetings.length === 0)
        throw new OptimizerInputError(`section ${section.id} has no meetings`);
      for (const meeting of section.meetings) {
        if (!DAY_INDEX.has(meeting.day))
          throw new OptimizerInputError(`section ${section.id} meets on unknown day ${meeting.day}`);
        if (!isInteger(meeting.start, 0, 24 * 60) || !isInteger(meeting.end, 0, 24 * 60) || meeting.end <= meeting.start) {
          throw new OptimizerInputError(`section ${section.id} has a meeting with invalid times ${meeting.start}-${meeting.end}`);
        }
      }
    }
  }
  for (const [courseCode, sectionId] of Object.entries(request.locks)) {
    if (!codes.has(courseCode))
      throw new OptimizerInputError(`lock on ${courseCode}, which is not a requested course`);
    if (sectionIds.get(sectionId) !== courseCode) {
      throw new OptimizerInputError(`lock on ${courseCode} names ${sectionId}, which is not one of its sections`);
    }
  }
  const excludedSeen = new Set;
  for (const sectionId of request.excluded) {
    if (!sectionIds.has(sectionId))
      throw new OptimizerInputError(`excluded section ${sectionId} is not in the request`);
    if (excludedSeen.has(sectionId))
      throw new OptimizerInputError(`excluded section ${sectionId} is listed twice`);
    excludedSeen.add(sectionId);
  }
  for (const [key, value] of Object.entries(request.weights)) {
    if (!isInteger(value, 0, MAX_WEIGHT))
      throw new OptimizerInputError(`weight ${key} must be an integer 0..${MAX_WEIGHT}, got ${value}`);
  }
  const constraints = request.constraints;
  for (const [key, value] of [
    ["earliestStart", constraints.earliestStart],
    ["latestEnd", constraints.latestEnd]
  ]) {
    if (value !== null && !isInteger(value, 0, 24 * 60))
      throw new OptimizerInputError(`${key} must be a minute of the day, got ${value}`);
  }
  for (const day of constraints.daysOff) {
    if (!DAY_INDEX.has(day))
      throw new OptimizerInputError(`unknown day off ${day}`);
  }
  const blockedIds = new Set;
  for (const block of constraints.blocked) {
    if (blockedIds.has(block.id))
      throw new OptimizerInputError(`blocked time ${block.id} is listed twice`);
    blockedIds.add(block.id);
    if (!DAY_INDEX.has(block.day) || !isInteger(block.start, 0, 24 * 60) || !isInteger(block.end, 0, 24 * 60) || block.end <= block.start) {
      throw new OptimizerInputError(`blocked time ${block.id} is invalid`);
    }
  }
  if (constraints.maxCredits !== null && !(Number.isFinite(constraints.maxCredits) && constraints.maxCredits >= 0)) {
    throw new OptimizerInputError(`maxCredits must be a non-negative number, got ${constraints.maxCredits}`);
  }
  if (constraints.walking !== null && !isInteger(constraints.walking.bufferMinutes, 0, 120)) {
    throw new OptimizerInputError(`walking buffer must be 0..120 minutes, got ${constraints.walking.bufferMinutes}`);
  }
  const k = request.k ?? 3;
  if (!isInteger(k, 1, 20))
    throw new OptimizerInputError(`k must be an integer 1..20, got ${k}`);
}
function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}
function passesTimeConstraints(section, constraints) {
  const off = new Set(constraints.daysOff);
  for (const meeting of section.meetings) {
    if (constraints.earliestStart !== null && meeting.start < constraints.earliestStart)
      return false;
    if (constraints.latestEnd !== null && meeting.end > constraints.latestEnd)
      return false;
    if (off.has(meeting.day))
      return false;
    for (const block of constraints.blocked) {
      if (block.day === meeting.day && meeting.start < block.end && block.start < meeting.end)
        return false;
    }
  }
  return true;
}
function timeSignatureOf(meetings) {
  return meetings.map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}`).sort().join(",");
}
function fullSignatureOf(meetings) {
  return meetings.map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}@${m.buildingId ?? ""}`).sort().join(",");
}
function allowedSections(course, request) {
  const excluded = new Set(request.excluded);
  const locked = request.locks[course.code];
  return course.sections.filter((section) => !excluded.has(section.id) && (locked === undefined || section.id === locked));
}
function minDifferentCourses(request) {
  let variable = 0;
  for (const course of request.courses) {
    const signatures = new Set(allowedSections(course, request).filter((section) => passesTimeConstraints(section, request.constraints)).map((section) => timeSignatureOf(section.meetings)));
    if (signatures.size >= 2)
      variable += 1;
  }
  return Math.max(1, Math.min(2, variable));
}
function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

class PrepareBudgetExhausted extends Error {
  constructor() {
    super("optimizer: time budget ran out while preparing");
  }
}
function prepare(request, deadline = Number.POSITIVE_INFINITY, now = () => performance.now()) {
  validateRequest(request);
  const { constraints, weights } = request;
  const sortedCourses = [...request.courses].sort((a, b) => compareIds(a.code, b.code));
  const checkDeadline = () => {
    if (deadline !== Number.POSITIVE_INFINITY && now() > deadline)
      throw new PrepareBudgetExhausted;
  };
  const walkingMatters = weights.walking > 0 || constraints.walking !== null;
  const buildingIndex = new Map;
  const intern = (id) => {
    if (id === null || !walkingMatters)
      return -1;
    let index = buildingIndex.get(id);
    if (index === undefined) {
      index = buildingIndex.size;
      buildingIndex.set(id, index);
    }
    return index;
  };
  const allowedByCourse = sortedCourses.map((course) => allowedSections(course, request).filter((section) => passesTimeConstraints(section, constraints)));
  let globalMinDuration = Number.POSITIVE_INFINITY;
  for (const list of allowedByCourse) {
    for (const section of list) {
      for (const meeting of section.meetings) {
        globalMinDuration = Math.min(globalMinDuration, meeting.end - meeting.start);
        intern(meeting.buildingId);
      }
    }
  }
  const buildingCount = buildingIndex.size;
  const walk = new Float64Array(buildingCount * buildingCount);
  const buildingIds = [...buildingIndex.keys()];
  for (let a = 0;a < buildingCount; a += 1) {
    checkDeadline();
    for (let b = 0;b < buildingCount; b += 1) {
      const seconds = walkSeconds(request.walkingTime, buildingIds[a], buildingIds[b]);
      walk[a * buildingCount + b] = seconds === null ? -1 : seconds;
    }
  }
  const bufferMinutes = constraints.walking?.bufferMinutes ?? null;
  const walkOf = (from, to) => {
    if (from >= 0 && from === to)
      return 0;
    if (from < 0 || to < 0)
      return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };
  const tightPair = (prev, next) => bufferMinutes !== null && !(prev.building >= 0 && prev.building === next.building) && next.start - prev.end < globalMinDuration && !transferFits(prev, next, walkOf(prev.building, next.building), bufferMinutes);
  const neutralRatingByCourse = {};
  const creditsByCourse = {};
  const courses = [];
  const candidates = [];
  let word = 0;
  const signatureIds = new Map;
  sortedCourses.forEach((course, courseIndex) => {
    const neutral = neutralRatingTenths(course.sections);
    neutralRatingByCourse[course.code] = neutral;
    creditsByCourse[course.code] = course.credits;
    const allowed = allowedByCourse[courseIndex];
    const kept = [];
    for (const section of allowed) {
      const meetings = section.meetings.map((m) => ({ day: DAY_INDEX.get(m.day), start: m.start, end: m.end, building: intern(m.buildingId) })).sort((a, b) => a.day - b.day || a.start - b.start);
      let selfBroken = false;
      for (let i = 0;i < meetings.length && !selfBroken; i += 1) {
        for (let j = i + 1;j < meetings.length; j += 1) {
          if (overlaps(meetings[i], meetings[j])) {
            selfBroken = true;
            break;
          }
        }
        const next = meetings[i + 1];
        if (next && next.day === meetings[i].day && tightPair(meetings[i], next))
          selfBroken = true;
      }
      if (selfBroken)
        continue;
      const signature = timeSignatureOf(section.meetings);
      let signatureId = signatureIds.get(signature);
      if (signatureId === undefined) {
        signatureId = signatureIds.size;
        signatureIds.set(signature, signatureId);
      }
      kept.push({
        bit: -1,
        section,
        course: courseIndex,
        self: selfCost(section, weights, neutral),
        dayMask: meetings.reduce((mask, m) => mask | 1 << m.day, 0),
        timeSignature: signatureId,
        meetings
      });
    }
    const walkingMatters2 = weights.walking > 0 || constraints.walking !== null;
    const ordered = dropTwins(kept, walkingMatters2).sort((a, b) => a.self - b.self || compareIds(a.section.id, b.section.id));
    const wordLo = word;
    ordered.forEach((candidate, index) => {
      candidate.bit = wordLo * 32 + index;
      candidates.push(candidate);
    });
    word += Math.max(1, Math.ceil(ordered.length / 32));
    courses.push({
      code: course.code,
      credits: course.credits,
      candidates: ordered,
      wordLo,
      wordHi: word,
      byDayMask: [],
      sectionsBeforeConstraints: allowedSections(course, request).length
    });
  });
  const words = word;
  for (const course of courses) {
    const groups = new Map;
    for (const candidate of course.candidates) {
      let bits = groups.get(candidate.dayMask);
      if (!bits) {
        bits = new Uint32Array(words);
        groups.set(candidate.dayMask, bits);
      }
      bits[candidate.bit >>> 5] |= 1 << (candidate.bit & 31);
    }
    course.byDayMask = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([dayMask, bits]) => ({ dayMask, bits }));
  }
  const conflicts = [];
  for (const candidate of candidates)
    conflicts[candidate.bit] = new Uint32Array(words);
  for (let i = 0;i < candidates.length; i += 1) {
    if ((i & 15) === 0)
      checkDeadline();
    for (let j = i + 1;j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.course === b.course)
        continue;
      if (incompatible(a, b, tightPair)) {
        conflicts[a.bit][b.bit >>> 5] |= 1 << (b.bit & 31);
        conflicts[b.bit][a.bit >>> 5] |= 1 << (a.bit & 31);
      }
    }
  }
  const timeSet = new Set;
  for (const candidate of candidates) {
    for (const meeting of candidate.meetings) {
      timeSet.add(meeting.start);
      timeSet.add(meeting.end);
    }
  }
  const times = [...timeSet].sort((a, b) => a - b);
  const timeIndex = new Int16Array(24 * 60 + 1).fill(-1);
  times.forEach((minute, index) => timeIndex[minute] = index);
  const t = times.length;
  const fill = courses.map((course) => OPT_DAYS.map((_, day) => {
    const table = new Int16Array(t * t);
    for (const candidate of course.candidates) {
      const own = candidate.meetings.filter((meeting) => meeting.day === day);
      for (let first = 0;first < own.length; first += 1) {
        let total = 0;
        for (let last = first;last < own.length; last += 1) {
          total += own[last].end - own[last].start;
          const k = timeIndex[own[first].start] * t + timeIndex[own[last].end];
          if (total > table[k])
            table[k] = total;
        }
      }
    }
    for (let i = t - 1;i >= 0; i -= 1) {
      for (let j = 0;j < t; j += 1) {
        let value = table[i * t + j];
        if (i + 1 < t && table[(i + 1) * t + j] > value)
          value = table[(i + 1) * t + j];
        if (j > 0 && table[i * t + j - 1] > value)
          value = table[i * t + j - 1];
        table[i * t + j] = value;
      }
    }
    return table;
  }));
  const nodes = buildingCount + 1;
  const walkFloor = new Float64Array(nodes * nodes);
  for (let a = 0;a < nodes; a += 1) {
    for (let b = 0;b < nodes; b += 1) {
      const known = a < buildingCount && b < buildingCount ? walkOf(a, b) : null;
      walkFloor[a * nodes + b] = a === b && a < buildingCount ? 0 : known ?? UNKNOWN_WALK_SECONDS;
    }
  }
  for (let via = 0;via < nodes; via += 1) {
    for (let a = 0;a < nodes; a += 1) {
      for (let b = 0;b < nodes; b += 1) {
        const through = walkFloor[a * nodes + via] + walkFloor[via * nodes + b];
        if (through < walkFloor[a * nodes + b])
          walkFloor[a * nodes + b] = through;
      }
    }
  }
  return {
    walkFloor,
    times,
    timeIndex,
    fill,
    courses,
    candidates,
    words,
    conflicts,
    walk,
    buildingCount,
    bufferSeconds: bufferMinutes === null ? null : bufferMinutes * 60,
    weights,
    totalCredits: sortedCourses.reduce((sum, course) => sum + course.credits, 0),
    maxCredits: constraints.maxCredits,
    minDifferentCourses: minDifferentCourses(request),
    creditsByCourse,
    neutralRatingByCourse
  };
}
function incompatible(a, b, tightPair) {
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (overlaps(ma, mb))
        return true;
    }
  }
  if ((a.dayMask & b.dayMask) === 0)
    return false;
  const merged = [
    ...a.meetings.map((meeting) => ({ meeting, from: 0 })),
    ...b.meetings.map((meeting) => ({ meeting, from: 1 }))
  ].sort((x, y) => x.meeting.day - y.meeting.day || x.meeting.start - y.meeting.start);
  for (let i = 1;i < merged.length; i += 1) {
    const prev = merged[i - 1];
    const next = merged[i];
    if (prev.meeting.day !== next.meeting.day || prev.from === next.from)
      continue;
    if (tightPair(prev.meeting, next.meeting))
      return true;
  }
  return false;
}
function dropTwins(candidates, walkingMatters) {
  const best = new Map;
  for (const candidate of candidates) {
    const key = walkingMatters ? fullSignatureOf(candidate.section.meetings) : timeSignatureOf(candidate.section.meetings);
    const current = best.get(key);
    if (!current || candidate.self < current.self || candidate.self === current.self && compareIds(candidate.section.id, current.section.id) < 0) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

// src/lib/optimizer/search.ts
class BudgetExhausted {
}

class FoundOne {
}
function compareKeys(a, b) {
  for (let i = 0;i < a.length; i += 1) {
    if (a[i] !== b[i])
      return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
function leafBefore(a, b) {
  return a.cost < b.cost || a.cost === b.cost && compareKeys(a.key, b.key) < 0;
}
function popcount(value) {
  let v = value - (value >>> 1 & 1431655765);
  v = (v & 858993459) + (v >>> 2 & 858993459);
  return (v + (v >>> 4) & 252645135) * 16843009 >>> 24;
}
function search(prepared, budget, options) {
  const { courses, words, conflicts, walk, buildingCount, bufferSeconds, weights } = prepared;
  const n = courses.length;
  const candidateByBit = [];
  for (const candidate of prepared.candidates)
    candidateByBit[candidate.bit] = candidate;
  let best = options.incumbent;
  if (prepared.maxCredits !== null && prepared.totalCredits > prepared.maxCredits) {
    return { best: null, complete: true };
  }
  const assigned = new Array(n).fill(null);
  const aliveStack = [];
  for (let depth = 0;depth <= n; depth += 1)
    aliveStack.push(new Uint32Array(words));
  for (const candidate of prepared.candidates)
    aliveStack[0][candidate.bit >>> 5] |= 1 << (candidate.bit & 31);
  const scratch = new Uint32Array(words);
  const dayLists = [[], [], [], [], []];
  let daysUsed = 0;
  let selfSum = 0;
  let assignedCount = 0;
  const previous = options.previous;
  const same = new Int32Array(previous.length);
  const minDifferent = options.minDifferent;
  const walkOf = (from, to) => {
    if (from >= 0 && from === to)
      return 0;
    if (from < 0 || to < 0)
      return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };
  const { times, timeIndex, fill, walkFloor } = prepared;
  const floorStride = buildingCount + 1;
  const timeCount = times.length;
  const pairsMatter = weights.compact > 0 || weights.walking > 0 || bufferSeconds !== null;
  function dayCost(day, remaining, remainingCount) {
    const list = dayLists[day];
    let gap = 0;
    let walkCost = 0;
    for (let i = 1;i < list.length; i += 1) {
      const prev = list[i - 1];
      const next = list[i];
      const window = next.start - prev.end;
      const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
      let filled = 0;
      for (let r = 0;r < remainingCount && filled < window; r += 1)
        filled += fill[remaining[r]][day][cell];
      if (filled > 0) {
        if (filled < window)
          gap += window - filled;
        if (!(prev.building >= 0 && prev.building === next.building)) {
          walkCost += walkFloor[(prev.building < 0 ? buildingCount : prev.building) * floorStride + (next.building < 0 ? buildingCount : next.building)];
        }
        continue;
      }
      gap += window;
      if (prev.building >= 0 && prev.building === next.building)
        continue;
      const seconds = walkOf(prev.building, next.building);
      walkCost += seconds ?? UNKNOWN_WALK_SECONDS;
      if (bufferSeconds !== null && window * 60 < (seconds ?? UNKNOWN_WALK_SECONDS) + bufferSeconds)
        return -1;
    }
    return weights.compact * COST_PER_GAP_MINUTE * gap + weights.walking * COST_PER_WALK_SECOND * walkCost;
  }
  const noRemaining = new Int32Array(0);
  function completeCost() {
    let total = 0;
    for (let d = 0;d < 5; d += 1) {
      const cost = dayCost(d, noRemaining, 0);
      if (cost < 0)
        return -1;
      total += cost;
    }
    return total;
  }
  const remainingStack = [];
  const dayStack = [];
  for (let depth = 0;depth <= n; depth += 1) {
    remainingStack.push(new Int32Array(n));
    dayStack.push(new Float64Array(5));
  }
  function insertMeetings(candidate) {
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
  function removeMeetings(candidate) {
    for (const meeting of candidate.meetings) {
      const list = dayLists[meeting.day];
      let index = list.indexOf(meeting);
      for (;index < list.length - 1; index += 1)
        list[index] = list[index + 1];
      list.pop();
    }
  }
  function tick() {
    budget.nodes += 1;
    if (budget.nodes > budget.maxNodes)
      throw new BudgetExhausted;
    if ((budget.nodes & 31) === 0 && budget.now() > budget.deadline)
      throw new BudgetExhausted;
  }
  function evaluate(candidate, alive, depth) {
    const c = candidate.course;
    const remainingAfter = n - assignedCount - 1;
    for (let j = 0;j < previous.length; j += 1) {
      const matches = same[j] + (previous[j].picks[c].timeSignature === candidate.timeSignature ? 1 : 0);
      if (assignedCount + 1 - matches + remainingAfter < minDifferent)
        return Number.POSITIVE_INFINITY;
    }
    const nodeDays = dayStack[depth];
    for (let d = 0;d < 5; d += 1) {
      if ((candidate.dayMask & 1 << d) === 0 && nodeDays[d] < 0)
        return Number.POSITIVE_INFINITY;
    }
    const conflict = conflicts[candidate.bit];
    for (let w = 0;w < words; w += 1)
      scratch[w] = alive[w] & ~conflict[w];
    const nextDays = daysUsed | candidate.dayMask;
    const dayPrice = weights.fewerDays * COST_PER_DAY;
    let lowerSelf = selfSum + candidate.self;
    let mostNewDays = 0;
    const remaining = remainingStack[depth];
    for (let r = 0;r < remainingAfter; r += 1) {
      const course = courses[remaining[r]];
      let first = -1;
      for (let w = course.wordLo;w < course.wordHi && first < 0; w += 1) {
        const value = scratch[w];
        if (value !== 0)
          first = w * 32 + 31 - Math.clz32(value & -value);
      }
      if (first < 0)
        return Number.POSITIVE_INFINITY;
      lowerSelf += candidateByBit[first].self;
      if (dayPrice === 0 || mostNewDays === 5)
        continue;
      let fewestNew = 6;
      for (const group of course.byDayMask) {
        const added = popcount(group.dayMask & ~nextDays);
        if (added >= fewestNew)
          continue;
        for (let w = course.wordLo;w < course.wordHi; w += 1) {
          if ((group.bits[w] & scratch[w]) !== 0) {
            fewestNew = added;
            break;
          }
        }
        if (fewestNew <= mostNewDays)
          break;
      }
      if (fewestNew > mostNewDays)
        mostNewDays = fewestNew;
    }
    let pairs = 0;
    if (pairsMatter) {
      insertMeetings(candidate);
      for (let d = 0;d < 5; d += 1) {
        if ((candidate.dayMask & 1 << d) === 0) {
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
      if (pairs < 0)
        return Number.POSITIVE_INFINITY;
    }
    const bound = lowerSelf + dayPrice * (popcount(nextDays) + mostNewDays) + pairs;
    if (best !== null) {
      if (bound > best.cost)
        return Number.POSITIVE_INFINITY;
      if (bound === best.cost && !canWinTie(candidate))
        return Number.POSITIVE_INFINITY;
    }
    return bound;
  }
  function canWinTie(candidate) {
    const target = best.key;
    for (let u = 0;u < n; u += 1) {
      let lowest;
      if (u === candidate.course)
        lowest = candidate.section.id;
      else if (assigned[u] !== null)
        lowest = assigned[u].section.id;
      else {
        const course = courses[u];
        lowest = "￿";
        for (let w = course.wordLo;w < course.wordHi; w += 1) {
          let value = scratch[w];
          while (value !== 0) {
            const low = value & -value;
            const id = candidateByBit[w * 32 + 31 - Math.clz32(low)].section.id;
            if (id < lowest)
              lowest = id;
            value ^= low;
          }
        }
      }
      if (lowest !== target[u])
        return lowest < target[u];
    }
    return false;
  }
  function recordLeaf() {
    const picks = assigned;
    const pairs = completeCost();
    if (pairs < 0)
      return;
    const cost = selfSum + weights.fewerDays * COST_PER_DAY * popcount(daysUsed) + pairs;
    const leaf = { picks: [...picks], cost, key: picks.map((pick) => pick.section.id) };
    options.onLeaf?.(leaf);
    if (options.stopAtFirst) {
      best = leaf;
      throw new FoundOne;
    }
    if (best === null || leafBefore(leaf, best))
      best = leaf;
  }
  const unassignedScratch = new Int32Array(n);
  const selfMatters = weights.mornings > 0 || weights.evenings > 0 || weights.rating > 0;
  const minSelfScratch = new Float64Array(n);
  const gainScratch = new Float64Array(n * n);
  const matchScratch = new Float64Array(1 << Math.min(n, 16));
  function pairSelfGains(alive, all, count) {
    if (count > 16)
      return 0;
    for (let r = 0;r < count; r += 1) {
      const c = courses[all[r]];
      let first = -1;
      for (let w = c.wordLo;w < c.wordHi && first < 0; w += 1) {
        const value = alive[w];
        if (value !== 0)
          first = w * 32 + 31 - Math.clz32(value & -value);
      }
      minSelfScratch[r] = candidateByBit[first].self;
    }
    for (let a = 0;a < count; a += 1) {
      const ca = courses[all[a]];
      for (let b = a + 1;b < count; b += 1) {
        const cb = courses[all[b]];
        let bestPair = Number.POSITIVE_INFINITY;
        for (let w = ca.wordLo;w < ca.wordHi; w += 1) {
          let value = alive[w];
          while (value !== 0) {
            const low = value & -value;
            value ^= low;
            const x = candidateByBit[w * 32 + 31 - Math.clz32(low)];
            if (x.self + minSelfScratch[b] >= bestPair)
              break;
            const conflict = conflicts[x.bit];
            for (let v = cb.wordLo;v < cb.wordHi; v += 1) {
              const open = alive[v] & ~conflict[v];
              if (open !== 0) {
                const y = candidateByBit[v * 32 + 31 - Math.clz32(open & -open)];
                if (x.self + y.self < bestPair)
                  bestPair = x.self + y.self;
                break;
              }
            }
          }
          if (bestPair !== Number.POSITIVE_INFINITY && w + 1 < ca.wordHi) {
            const nextValue = alive[w + 1];
            if (nextValue !== 0) {
              const next = candidateByBit[(w + 1) * 32 + 31 - Math.clz32(nextValue & -nextValue)];
              if (next.self + minSelfScratch[b] >= bestPair)
                break;
            }
          }
        }
        if (bestPair === Number.POSITIVE_INFINITY)
          return -1;
        gainScratch[a * count + b] = bestPair - minSelfScratch[a] - minSelfScratch[b];
      }
    }
    const full = (1 << count) - 1;
    matchScratch[0] = 0;
    for (let mask = 1;mask <= full; mask += 1) {
      const i = 31 - Math.clz32(mask & -mask);
      const rest = mask & ~(1 << i);
      let value = matchScratch[rest];
      let others = rest;
      while (others !== 0) {
        const j = 31 - Math.clz32(others & -others);
        others &= others - 1;
        const candidate = matchScratch[rest & ~(1 << j)] + gainScratch[i * count + j];
        if (candidate > value)
          value = candidate;
      }
      matchScratch[mask] = value;
    }
    return matchScratch[full];
  }
  function forcedOn(u, day, alive) {
    const course = courses[u];
    for (const group of course.byDayMask) {
      if ((group.dayMask & 1 << day) !== 0)
        continue;
      for (let w = course.wordLo;w < course.wordHi; w += 1)
        if ((group.bits[w] & alive[w]) !== 0)
          return false;
    }
    return true;
  }
  function nodeFloor(alive, course, remaining, remainingCount) {
    const all = unassignedScratch;
    all[0] = course;
    for (let r = 0;r < remainingCount; r += 1)
      all[r + 1] = remaining[r];
    const count = remainingCount + 1;
    const dayPrice = weights.fewerDays * COST_PER_DAY;
    let self2 = selfSum;
    let mostNewDays = 0;
    for (let r = 0;r < count; r += 1) {
      const c = courses[all[r]];
      let first = -1;
      for (let w = c.wordLo;w < c.wordHi && first < 0; w += 1) {
        const value = alive[w];
        if (value !== 0)
          first = w * 32 + 31 - Math.clz32(value & -value);
      }
      if (first < 0)
        return -1;
      self2 += candidateByBit[first].self;
      if (dayPrice === 0)
        continue;
      let fewestNew = 6;
      for (const group of c.byDayMask) {
        const added = popcount(group.dayMask & ~daysUsed);
        if (added >= fewestNew)
          continue;
        for (let w = c.wordLo;w < c.wordHi; w += 1) {
          if ((group.bits[w] & alive[w]) !== 0) {
            fewestNew = added;
            break;
          }
        }
      }
      if (fewestNew > mostNewDays)
        mostNewDays = fewestNew;
    }
    if (selfMatters && count >= 2) {
      const pairGain = pairSelfGains(alive, all, count);
      if (pairGain < 0)
        return -1;
      self2 += pairGain;
    }
    let pairs = 0;
    let outside = 0;
    for (let d = 0;d < 5 && weights.compact > 0; d += 1) {
      const inside = dayCost(d, all, count);
      if (inside < 0)
        return -1;
      pairs += inside;
      const list = dayLists[d];
      if (list.length === 0)
        continue;
      const spanStart = list[0].start;
      const spanEnd = list[list.length - 1].end;
      let right = 0;
      let left = 0;
      for (let r = 0;r < count; r += 1) {
        const u = all[r];
        if (!forcedOn(u, d, alive))
          continue;
        const c = courses[u];
        let minRight = Number.POSITIVE_INFINITY;
        let minLeft = Number.POSITIVE_INFINITY;
        for (let w = c.wordLo;w < c.wordHi && (minRight > 0 || minLeft > 0); w += 1) {
          let value = alive[w];
          while (value !== 0 && (minRight > 0 || minLeft > 0)) {
            const low = value & -value;
            value ^= low;
            const candidate = candidateByBit[w * 32 + 31 - Math.clz32(low)];
            let extRight = Number.POSITIVE_INFINITY;
            let extLeft = Number.POSITIVE_INFINITY;
            for (const m of candidate.meetings) {
              if (m.day !== d)
                continue;
              let stretchRight = 0;
              let stretchLeft = 0;
              if (m.start >= spanEnd) {
                const cell = timeIndex[spanEnd] * timeCount + timeIndex[m.start];
                let filled = 0;
                for (let q = 0;q < count; q += 1)
                  if (all[q] !== u)
                    filled += fill[all[q]][d][cell];
                stretchRight = Math.max(0, m.start - spanEnd - filled);
              } else if (m.end <= spanStart) {
                const cell = timeIndex[m.end] * timeCount + timeIndex[spanStart];
                let filled = 0;
                for (let q = 0;q < count; q += 1)
                  if (all[q] !== u)
                    filled += fill[all[q]][d][cell];
                stretchLeft = Math.max(0, spanStart - m.end - filled);
              }
              if (stretchRight < extRight)
                extRight = stretchRight;
              if (stretchLeft < extLeft)
                extLeft = stretchLeft;
            }
            if (extRight < minRight)
              minRight = extRight;
            if (extLeft < minLeft)
              minLeft = extLeft;
          }
        }
        if (minRight !== Number.POSITIVE_INFINITY && minRight > right)
          right = minRight;
        if (minLeft !== Number.POSITIVE_INFINITY && minLeft > left)
          left = minLeft;
      }
      outside += right + left;
    }
    return self2 + dayPrice * (popcount(daysUsed) + mostNewDays) + pairs + weights.compact * COST_PER_GAP_MINUTE * outside;
  }
  function dfs(depth) {
    tick();
    if (depth === n) {
      recordLeaf();
      return;
    }
    const alive = aliveStack[depth];
    let course = -1;
    let fewest = Number.POSITIVE_INFINITY;
    for (let u = 0;u < n; u += 1) {
      if (assigned[u] !== null)
        continue;
      let count = 0;
      for (let w = courses[u].wordLo;w < courses[u].wordHi; w += 1)
        count += popcount(alive[w]);
      if (count === 0)
        return;
      if (count < fewest) {
        fewest = count;
        course = u;
      }
    }
    const remaining = remainingStack[depth];
    let remainingCount = 0;
    for (let u = 0;u < n; u += 1)
      if (u !== course && assigned[u] === null)
        remaining[remainingCount++] = u;
    const nodeDays = dayStack[depth];
    for (let d = 0;d < 5; d += 1)
      nodeDays[d] = pairsMatter ? dayCost(d, remaining, remainingCount) : 0;
    const floor = weights.compact > 0 || selfMatters ? nodeFloor(alive, course, remaining, remainingCount) : 0;
    if (floor < 0 || best !== null && floor > best.cost)
      return;
    const children = [];
    const { wordLo, wordHi } = courses[course];
    for (let w = wordLo;w < wordHi; w += 1) {
      let value = alive[w];
      while (value !== 0) {
        const low = value & -value;
        value ^= low;
        const candidate = candidateByBit[w * 32 + 31 - Math.clz32(low)];
        const bound = evaluate(candidate, alive, depth);
        if (bound !== Number.POSITIVE_INFINITY)
          children.push({ bound: Math.max(bound, floor), candidate });
      }
    }
    children.sort((a, b) => a.bound - b.bound || a.candidate.bit - b.candidate.bit);
    for (const child of children) {
      const candidate = child.candidate;
      if (best !== null && child.bound > best.cost)
        break;
      if (best !== null && child.bound === best.cost) {
        if (evaluate(candidate, alive, depth) === Number.POSITIVE_INFINITY)
          continue;
      }
      const next = aliveStack[depth + 1];
      const conflict = conflicts[candidate.bit];
      for (let w = 0;w < words; w += 1)
        next[w] = alive[w] & ~conflict[w];
      assigned[candidate.course] = candidate;
      selfSum += candidate.self;
      const previousDays = daysUsed;
      daysUsed |= candidate.dayMask;
      insertMeetings(candidate);
      for (let j = 0;j < previous.length; j += 1) {
        if (previous[j].picks[candidate.course].timeSignature === candidate.timeSignature)
          same[j] += 1;
      }
      assignedCount += 1;
      dfs(depth + 1);
      assignedCount -= 1;
      for (let j = 0;j < previous.length; j += 1) {
        if (previous[j].picks[candidate.course].timeSignature === candidate.timeSignature)
          same[j] -= 1;
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
    if (signal instanceof FoundOne)
      return { best, complete: true };
    if (signal instanceof BudgetExhausted)
      return { best, complete: false };
    throw signal;
  }
  return { best, complete: true };
}
function isFeasible(prepared, budget) {
  const outcome = search(prepared, budget, { previous: [], minDifferent: 0, stopAtFirst: true, incumbent: null });
  if (outcome.best !== null)
    return true;
  return outcome.complete ? false : null;
}
function differingCourses(a, b) {
  let count = 0;
  for (let i = 0;i < a.picks.length; i += 1) {
    if (a.picks[i].timeSignature !== b.picks[i].timeSignature)
      count += 1;
  }
  return count;
}

// src/lib/optimizer/explain.ts
function memberKey(member) {
  switch (member.kind) {
    case "course":
      return `course:${member.courseCode}`;
    case "lock":
      return `lock:${member.courseCode}`;
    case "excluded":
      return `excluded:${member.sectionId}`;
    case "dayOff":
      return `dayOff:${member.day}`;
    case "blocked":
      return `blocked:${member.blockedId}`;
    default:
      return member.kind;
  }
}
function allMembers(request) {
  const members = [];
  const codes = request.courses.map((course) => course.code).sort();
  for (const code of codes)
    members.push({ kind: "course", courseCode: code });
  for (const sectionId of [...request.excluded].sort())
    members.push({ kind: "excluded", sectionId });
  for (const code of codes) {
    const sectionId = request.locks[code];
    if (sectionId !== undefined)
      members.push({ kind: "lock", courseCode: code, sectionId });
  }
  const c = request.constraints;
  for (const block of c.blocked)
    members.push({ kind: "blocked", blockedId: block.id });
  for (const day of OPT_DAYS)
    if (c.daysOff.includes(day))
      members.push({ kind: "dayOff", day });
  if (c.earliestStart !== null)
    members.push({ kind: "earliestStart" });
  if (c.latestEnd !== null)
    members.push({ kind: "latestEnd" });
  if (c.walking !== null)
    members.push({ kind: "walking" });
  if (c.maxCredits !== null)
    members.push({ kind: "maxCredits" });
  return members;
}
function restrictTo(request, members) {
  const keys = new Set(members.map(memberKey));
  const courses = request.courses.filter((course) => keys.has(`course:${course.code}`));
  const kept = new Set(courses.map((course) => course.code));
  const sectionCourse = new Map;
  for (const course of courses)
    for (const section of course.sections)
      sectionCourse.set(section.id, course.code);
  const c = request.constraints;
  return {
    ...request,
    courses,
    locks: Object.fromEntries(Object.entries(request.locks).filter(([code]) => kept.has(code) && keys.has(`lock:${code}`))),
    excluded: request.excluded.filter((id) => sectionCourse.has(id) && keys.has(`excluded:${id}`)),
    constraints: {
      earliestStart: keys.has("earliestStart") ? c.earliestStart : null,
      latestEnd: keys.has("latestEnd") ? c.latestEnd : null,
      daysOff: c.daysOff.filter((day) => keys.has(`dayOff:${day}`)),
      blocked: c.blocked.filter((block) => keys.has(`blocked:${block.id}`)),
      maxCredits: keys.has("maxCredits") ? c.maxCredits : null,
      walking: keys.has("walking") ? c.walking : null
    }
  };
}
function makeCheck(deadline, now) {
  return (request) => {
    const budget = { deadline, maxNodes: Number.POSITIVE_INFINITY, now, nodes: 0 };
    if (now() > deadline)
      return null;
    try {
      return isFeasible(prepare(request, deadline, now), budget);
    } catch (error) {
      if (error instanceof PrepareBudgetExhausted)
        return null;
      throw error;
    }
  };
}
function sharesADay(request, code, others) {
  const days = (c) => new Set(request.courses.find((course) => course.code === c).sections.flatMap((s) => s.meetings.map((m) => m.day)));
  const own = days(code);
  return others.some((other) => [...days(other)].some((day) => own.has(day)));
}
function findConflictSet(request, check) {
  const all = allMembers(request);
  const courses = all.filter((member) => member.kind === "course");
  let others = all.filter((member) => member.kind !== "course");
  let decided = true;
  for (const member of [...others]) {
    const without = others.filter((m) => memberKey(m) !== memberKey(member));
    const verdict = check(restrictTo(request, [...courses, ...without]));
    if (verdict === false)
      others = without;
    else if (verdict === null)
      decided = false;
  }
  const walking = others.some((member) => member.kind === "walking");
  let kept = [...courses, ...others];
  for (const member of courses) {
    const code = member.courseCode;
    const remainingCodes = kept.filter((m) => m.kind === "course" && m.courseCode !== code).map((m) => m.courseCode);
    if (walking && sharesADay(request, code, remainingCodes))
      continue;
    const pruned = kept.filter((m) => memberKey(m) !== memberKey(member) && !(m.kind === "lock" && m.courseCode === code));
    const verdict = check(restrictTo(request, pruned));
    if (verdict === false)
      kept = pruned;
    else if (verdict === null)
      decided = false;
  }
  const keptCodes = new Set(kept.filter((m) => m.kind === "course").map((m) => m.courseCode));
  const sectionCourse = new Map(request.courses.flatMap((c) => c.sections.map((s) => [s.id, c.code])));
  kept = kept.filter((m) => m.kind !== "excluded" || keptCodes.has(sectionCourse.get(m.sectionId) ?? ""));
  let minimal = decided && check(restrictTo(request, kept)) === false;
  for (const member of kept) {
    if (!minimal)
      break;
    if (check(restrictTo(request, kept.filter((m) => memberKey(m) !== memberKey(member)))) !== true)
      minimal = false;
  }
  return { members: kept, minimal };
}
function formatClock(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return mins === 0 ? `${hour} ${suffix}` : `${hour}:${String(mins).padStart(2, "0")} ${suffix}`;
}
var DAY_LETTER = { Mon: "M", Tue: "T", Wed: "W", Thu: "Th", Fri: "F" };
var DAY_PLURAL = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays" };
var DAY_NAME = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
function describePattern(section) {
  const byStart = new Map;
  for (const meeting of section.meetings)
    byStart.set(meeting.start, [...byStart.get(meeting.start) ?? [], meeting.day]);
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, days]) => {
    const ordered = OPT_DAYS.filter((day) => days.includes(day));
    return `${ordered.map((day) => DAY_LETTER[day]).join("")} ${formatClock(start)}`;
  }).join(", ");
}
function joinList(items) {
  if (items.length <= 1)
    return items.join("");
  if (items.length === 2)
    return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function sectionLabel(section) {
  return section.label ?? section.id;
}
function conditionPhrases(request, members) {
  const c = request.constraints;
  const has = (kind) => members.some((member) => member.kind === kind);
  const phrases = [];
  if (has("earliestStart") && has("latestEnd")) {
    phrases.push(`between ${formatClock(c.earliestStart)} and ${formatClock(c.latestEnd)}`);
  } else if (has("earliestStart")) {
    phrases.push(`starting at ${formatClock(c.earliestStart)} or later`);
  } else if (has("latestEnd")) {
    phrases.push(`before ${formatClock(c.latestEnd)}`);
  }
  const days = OPT_DAYS.filter((day) => members.some((member) => member.kind === "dayOff" && member.day === day));
  if (days.length > 0)
    phrases.push(`with ${joinList(days.map((day) => DAY_PLURAL[day]))} off`);
  for (const member of members) {
    if (member.kind !== "blocked")
      continue;
    const block = c.blocked.find((entry) => entry.id === member.blockedId);
    phrases.push(`around your ${block.label} time (${DAY_NAME[block.day]} ${formatClock(block.start)}–${formatClock(block.end)})`);
  }
  if (has("walking")) {
    const buffer = c.walking?.bufferMinutes ?? 0;
    phrases.push(buffer > 0 ? `with time to walk between buildings plus ${buffer} minutes` : "with time to walk between buildings");
  }
  const excluded = members.filter((member) => member.kind === "excluded");
  if (excluded.length > 0) {
    const labels = excluded.map((member) => {
      const section = request.courses.flatMap((course) => course.sections).find((entry) => entry.id === member.sectionId);
      return `${section.courseCode} ${sectionLabel(section)}`;
    });
    phrases.push(`without ${joinList(labels)}`);
  }
  return phrases;
}
function explainSentence(request, members) {
  const codes = members.filter((member) => member.kind === "course").map((member) => member.courseCode);
  const locked = new Map(members.filter((member) => member.kind === "lock").map((member) => [member.courseCode, member.sectionId]));
  const sectionById = new Map(request.courses.flatMap((course) => course.sections).map((section) => [section.id, section]));
  const sub = restrictTo(request, members);
  if (members.some((member) => member.kind === "maxCredits")) {
    const credits = request.courses.filter((course) => codes.includes(course.code)).reduce((sum, course) => sum + course.credits, 0);
    return `${joinList(codes)} add up to ${credits} credits, over your ${request.constraints.maxCredits}-credit limit.`;
  }
  const conditions = conditionPhrases(request, members);
  const where = conditions.length > 0 ? ` ${conditions.join(" ")}` : "";
  const onlySection = (code) => {
    const lockedId = locked.get(code);
    if (lockedId)
      return sectionById.get(lockedId) ?? null;
    const prepared = prepare(sub);
    const course = prepared.courses.find((entry) => entry.code === code);
    return course && course.candidates.length === 1 ? course.candidates[0].section : null;
  };
  const describe = (code) => {
    const lockedId = locked.get(code);
    if (lockedId)
      return `your locked ${code} section (${describePattern(sectionById.get(lockedId))})`;
    return code;
  };
  if (codes.length === 1) {
    const code = codes[0];
    if (locked.has(code))
      return `Your locked ${code} section (${describePattern(sectionById.get(locked.get(code)))}) doesn't fit${where}.`;
    if (conditions.length === 0)
      return `No section of ${code} works: each one's own meetings clash.`;
    return `No section of ${code} fits${where}.`;
  }
  if (codes.length === 2) {
    const [a, b] = codes;
    const onlyA = onlySection(a);
    const onlyB = onlySection(b);
    if (conditions.length === 0) {
      if (onlyA && onlyB)
        return `${describe(a)} and ${describe(b)} overlap (${describePattern(onlyA)} and ${describePattern(onlyB)}).`.replace(/^./, (s) => s.toUpperCase());
      if (onlyB)
        return `Every section of ${a} overlaps ${locked.has(b) ? describe(b) : `${b}'s only section (${describePattern(onlyB)})`}.`;
      if (onlyA)
        return `Every section of ${b} overlaps ${locked.has(a) ? describe(a) : `${a}'s only section (${describePattern(onlyA)})`}.`;
      return `Every section of ${a} overlaps every section of ${b}.`;
    }
    if (onlyB && !onlyA)
      return `No section of ${a} fits alongside ${locked.has(b) ? describe(b) : `${b} (${describePattern(onlyB)})`}${where}.`;
    if (onlyA && !onlyB)
      return `No section of ${b} fits alongside ${locked.has(a) ? describe(a) : `${a} (${describePattern(onlyA)})`}${where}.`;
    return `No pair of ${a} and ${b} sections fits together${where}.`;
  }
  const names = codes.map(describe);
  return `${joinList(names)} can't all fit together${where}: every combination has a clash.`.replace(/^./, (s) => s.toUpperCase());
}
function fallbackSentence(request, members) {
  const codes = members.filter((m) => m.kind === "course").map((m) => m.courseCode);
  const locks = members.filter((m) => m.kind === "lock").map((m) => `your ${m.courseCode} lock`);
  const parts = [...codes, ...locks, ...conditionPhrases(request, members)];
  if (members.some((m) => m.kind === "maxCredits"))
    parts.push(`a ${request.constraints.maxCredits}-credit limit`);
  return `These can't all hold together: ${joinList(parts)}.`;
}
function applyRelaxation(request, relaxation) {
  const c = request.constraints;
  switch (relaxation.kind) {
    case "earliestStart":
      return { ...request, constraints: { ...c, earliestStart: relaxation.to } };
    case "latestEnd":
      return { ...request, constraints: { ...c, latestEnd: relaxation.to } };
    case "dayOff":
      return { ...request, constraints: { ...c, daysOff: c.daysOff.filter((day) => day !== relaxation.day) } };
    case "blocked":
      return { ...request, constraints: { ...c, blocked: c.blocked.filter((block) => block.id !== relaxation.blockedId) } };
    case "maxCredits":
      return { ...request, constraints: { ...c, maxCredits: relaxation.to } };
    case "walking":
      return { ...request, constraints: { ...c, walking: relaxation.to } };
    case "unlock": {
      const locks = { ...request.locks };
      delete locks[relaxation.courseCode];
      return { ...request, locks };
    }
    case "include":
      return { ...request, excluded: request.excluded.filter((id) => id !== relaxation.sectionId) };
  }
}
var STEP = 30;
function relaxationsFor(request, members, check) {
  const c = request.constraints;
  const sub = restrictTo(request, members);
  const fixesConflict = (relaxation) => check(applyRelaxation(sub, relaxation)) === true;
  const out = [];
  const sectionById = new Map(request.courses.flatMap((course) => course.sections).map((section) => [section.id, section]));
  for (const member of members) {
    switch (member.kind) {
      case "earliestStart": {
        let to = null;
        for (let t = c.earliestStart - STEP;t >= 6 * 60; t -= STEP) {
          if (fixesConflict({ kind: "earliestStart", to: t })) {
            to = t;
            break;
          }
        }
        out.push({ relaxation: { kind: "earliestStart", to }, label: to === null ? "Allow any start time" : `Start as early as ${formatClock(to)}` });
        break;
      }
      case "latestEnd": {
        let to = null;
        for (let t = c.latestEnd + STEP;t <= 22 * 60; t += STEP) {
          if (fixesConflict({ kind: "latestEnd", to: t })) {
            to = t;
            break;
          }
        }
        out.push({ relaxation: { kind: "latestEnd", to }, label: to === null ? "Allow any end time" : `Finish as late as ${formatClock(to)}` });
        break;
      }
      case "dayOff":
        out.push({ relaxation: { kind: "dayOff", day: member.day }, label: `Allow classes on ${DAY_PLURAL[member.day]}` });
        break;
      case "blocked": {
        const block = c.blocked.find((entry) => entry.id === member.blockedId);
        out.push({ relaxation: { kind: "blocked", blockedId: member.blockedId }, label: `Allow classes during ${block.label}` });
        break;
      }
      case "maxCredits": {
        const total = request.courses.reduce((sum, course) => sum + course.credits, 0);
        out.push({ relaxation: { kind: "maxCredits", to: total }, label: `Raise the credit limit to ${total}` });
        break;
      }
      case "walking": {
        const buffer = c.walking?.bufferMinutes ?? 0;
        if (buffer > 0 && fixesConflict({ kind: "walking", to: { bufferMinutes: 0 } })) {
          out.push({ relaxation: { kind: "walking", to: { bufferMinutes: 0 } }, label: "Drop the extra walking buffer" });
        } else {
          out.push({ relaxation: { kind: "walking", to: null }, label: "Allow tight walks between buildings" });
        }
        break;
      }
      case "lock":
        out.push({ relaxation: { kind: "unlock", courseCode: member.courseCode }, label: `Unlock ${member.courseCode}` });
        break;
      case "excluded": {
        const section = sectionById.get(member.sectionId);
        out.push({ relaxation: { kind: "include", sectionId: member.sectionId }, label: `Allow ${section.courseCode} ${sectionLabel(section)} again` });
        break;
      }
      case "course":
        break;
    }
  }
  return out;
}
function explainInfeasible(request, budgetMs, now) {
  const check = makeCheck(now() + budgetMs, now);
  const { members, minimal } = findConflictSet(request, check);
  const sentence = minimal ? explainSentence(request, members) : fallbackSentence(request, members);
  const suggestions = relaxationsFor(request, members, check).map((entry) => ({
    ...entry,
    resolves: check(applyRelaxation(request, entry.relaxation))
  }));
  suggestions.sort((a, b) => Number(b.resolves === true) - Number(a.resolves === true));
  return { members, minimal, sentence, suggestions };
}

// src/lib/optimizer/optimize.ts
var DEFAULT_K = 3;
var DEFAULT_TIME_BUDGET_MS = 300;
var DEFAULT_EXPLAIN_BUDGET_MS = 250;
var POOL_SIZE = 64;
var defaultNow = () => performance.now();
function optimize(request) {
  const now = request.now ?? defaultNow;
  const started = now();
  const k = request.k ?? DEFAULT_K;
  const budget = {
    deadline: started + (request.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS),
    maxNodes: request.maxNodes ?? Number.POSITIVE_INFINITY,
    now,
    nodes: 0
  };
  let prepared;
  try {
    prepared = prepare(request, budget.deadline, now);
  } catch (error) {
    if (!(error instanceof PrepareBudgetExhausted))
      throw error;
    return {
      status: "timeout",
      schedules: [],
      stats: { nodes: 0, elapsedMs: now() - started, candidates: {}, minDifferentCourses: 0 }
    };
  }
  const minDifferent = prepared.minDifferentCourses;
  const pool = [];
  const remember = (leaf) => {
    if (pool.length === POOL_SIZE && !leafBefore(leaf, pool[pool.length - 1]))
      return;
    if (pool.some((entry) => entry.key.every((id, i) => id === leaf.key[i])))
      return;
    let index = pool.length;
    while (index > 0 && leafBefore(leaf, pool[index - 1]))
      index -= 1;
    pool.splice(index, 0, leaf);
    if (pool.length > POOL_SIZE)
      pool.pop();
  };
  const distinctFrom = (leaf, picked) => picked.every((other) => differingCourses(leaf, other) >= minDifferent);
  const picks = [];
  let ranOut = false;
  for (let rank = 0;rank < k; rank += 1) {
    const previous = picks.map((pick) => pick.leaf);
    const seed = rank === 0 ? null : pool.find((leaf) => distinctFrom(leaf, previous)) ?? null;
    const outcome = now() > budget.deadline ? { best: seed, complete: false } : search(prepared, budget, { previous, minDifferent, stopAtFirst: false, incumbent: seed, onLeaf: remember });
    if (outcome.complete) {
      if (outcome.best === null)
        break;
      picks.push({ leaf: outcome.best, proven: true });
      continue;
    }
    ranOut = true;
    if (outcome.best !== null)
      picks.push({ leaf: outcome.best, proven: false });
    while (picks.length > 0 && picks.length < k) {
      const next = pool.find((leaf) => distinctFrom(leaf, picks.map((pick) => pick.leaf)));
      if (!next)
        break;
      picks.push({ leaf: next, proven: false });
    }
    break;
  }
  const stats = () => ({
    nodes: budget.nodes,
    elapsedMs: now() - started,
    candidates: Object.fromEntries(prepared.courses.map((course) => [course.code, course.candidates.length])),
    minDifferentCourses: minDifferent
  });
  if (picks.length === 0) {
    if (ranOut)
      return { status: "timeout", schedules: [], stats: stats() };
    const explanation = explainInfeasible(request, request.explainBudgetMs ?? DEFAULT_EXPLAIN_BUDGET_MS, now);
    return { status: "infeasible", schedules: [], explanation, stats: stats() };
  }
  const schedules = picks.map(({ leaf, proven }) => toRanked(request, prepared, leaf, proven));
  return ranOut ? { status: "feasible", schedules, stats: stats() } : { status: "optimal", schedules, stats: stats() };
}
function toRanked(request, prepared, leaf, proven) {
  const sections = leaf.picks.map((pick) => pick.section);
  const { cost, breakdown } = scoreSchedule({
    sections,
    creditsByCourse: prepared.creditsByCourse,
    neutralRatingByCourse: prepared.neutralRatingByCourse,
    weights: request.weights,
    walkingTime: request.walkingTime
  });
  if (cost !== leaf.cost) {
    throw new Error(`optimizer: search cost ${leaf.cost} disagrees with scorer cost ${cost} for ${leaf.key.join(", ")}`);
  }
  return {
    byCourse: Object.fromEntries(leaf.picks.map((pick) => [pick.section.courseCode, pick.section.id])),
    cost,
    breakdown,
    proven
  };
}

// src/lib/optimizer/worker/protocol.ts
var FIRST_BUDGET_MS = 300;
var FINAL_BUDGET_MS = 3000;
function walkingFromTable(table) {
  const index = new Map(table.ids.map((id, i) => [id, i]));
  const n = table.ids.length;
  return (from, to) => {
    const i = index.get(from);
    const j = index.get(to);
    if (i === undefined || j === undefined)
      return { seconds: null, source: "unknown" };
    return table.legs[i * n + j];
  };
}
function fromPlainRequest(plain, timeBudgetMs) {
  const { walking, ...rest } = plain;
  return { ...rest, walkingTime: walkingFromTable(walking), timeBudgetMs };
}
function isSettled(result) {
  return result.status === "optimal" || result.status === "infeasible";
}
function runJob(job, deps) {
  try {
    const first = deps.optimize(fromPlainRequest(job.request, FIRST_BUDGET_MS));
    const settled = isSettled(first);
    deps.post({ id: job.id, phase: "first", result: first, settled });
    if (settled)
      return;
    const final = deps.optimize(fromPlainRequest(job.request, FINAL_BUDGET_MS));
    deps.post({ id: job.id, phase: "final", result: final, settled: true });
  } catch (error) {
    deps.post({ id: job.id, phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

// src/lib/optimizer/worker/optimize.worker.ts
var scope = self;
scope.onmessage = (event) => {
  runJob(event.data, { optimize, post: (reply) => scope.postMessage(reply) });
};
