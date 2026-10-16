// Generated from optimize.worker.ts by `bun tests/optimizer/build-worker.ts --write`. Do not edit.
/* eslint-disable */
// src/lib/optimizer/types.ts
var OPT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var MAX_WEIGHT = 4;

class OptimizerInputError extends Error {
  constructor(message) {
    super(`optimizer: ${message}`);
    this.name = "OptimizerInputError";
  }
}

// src/lib/optimizer/weeks.ts
var DAY_MS = 86400000;
function dayNumber(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
    return null;
  const [year, month, day] = iso.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return ms / DAY_MS;
}
var MAX_WEEK_SEGMENTS = 32;
var rangeKey = (dates) => `${dates.start}/${dates.end}`;
function weekSegments(meetings, term, checkDeadline = () => {}) {
  const ranges = new Map;
  let steps = 0;
  for (const meeting of meetings) {
    if ((steps++ & 127) === 0)
      checkDeadline();
    const dates = meeting.dates ?? term;
    if (!dates)
      continue;
    if (meeting.dates && !term)
      throw new OptimizerInputError("term is required when any meeting has dates");
    const key = rangeKey(dates);
    let range = ranges.get(key);
    if (!range) {
      range = { id: ranges.size, start: dayNumber(dates.start), end: dayNumber(dates.end), days: 0 };
      ranges.set(key, range);
    }
    range.days |= 1 << OPT_DAYS.indexOf(meeting.day);
  }
  if (ranges.size === 0)
    return { count: 1, maskOf: () => 1 };
  const bitOfPattern = new Map;
  const masks = OPT_DAYS.map(() => new Int32Array(ranges.size));
  for (let weekday = 0;weekday < OPT_DAYS.length; weekday += 1) {
    const events = [];
    for (const range of ranges.values()) {
      if ((steps++ & 127) === 0)
        checkDeadline();
      if ((range.days & 1 << weekday) === 0)
        continue;
      const first = range.start + (weekday - (range.start + 3) % 7 + 7) % 7;
      const last = range.end - ((range.end + 3) % 7 - weekday + 14) % 7;
      if (first > last)
        continue;
      events.push({ date: first, id: range.id, add: true }, { date: last + 7, id: range.id, add: false });
    }
    events.sort((a, b) => {
      if ((steps++ & 1023) === 0)
        checkDeadline();
      return a.date - b.date;
    });
    const active = new Set;
    for (let i = 0;i < events.length; ) {
      checkDeadline();
      const date = events[i].date;
      do {
        const event = events[i++];
        if (event.add)
          active.add(event.id);
        else
          active.delete(event.id);
        if ((steps++ & 127) === 0)
          checkDeadline();
      } while (i < events.length && events[i].date === date);
      if (active.size === 0)
        continue;
      const ids = [...active].sort((a, b) => a - b);
      const pattern = ids.join(",");
      let bit = bitOfPattern.get(pattern);
      if (bit === undefined) {
        bit = bitOfPattern.size;
        if (bit === MAX_WEEK_SEGMENTS) {
          throw new OptimizerInputError(`meeting dates split the term into ${bit + 1} distinct stretches of weeks (${ranges.size} distinct date ranges); at most ${MAX_WEEK_SEGMENTS} are supported`);
        }
        bitOfPattern.set(pattern, bit);
      }
      for (const id of ids) {
        if ((steps++ & 127) === 0)
          checkDeadline();
        masks[weekday][id] |= 1 << bit;
      }
    }
  }
  return {
    count: Math.max(1, bitOfPattern.size),
    maskOf: (meeting) => {
      const dates = meeting.dates ?? term;
      const range = dates && ranges.get(rangeKey(dates));
      if (!range)
        throw new Error("optimizer: no week segments for meeting range");
      return masks[OPT_DAYS.indexOf(meeting.day)][range.id];
    }
  };
}
function someBackToBack(sorted, test) {
  for (let i = 0;i + 1 < sorted.length; i += 1) {
    const prev = sorted[i];
    let between = 0;
    for (let j = i + 1;j < sorted.length && sorted[j].day === prev.day; j += 1) {
      const next = sorted[j];
      if ((prev.weeks & next.weeks & ~between) !== 0 && test(prev, next))
        return true;
      between |= next.weeks;
      if ((prev.weeks & ~between) === 0)
        break;
    }
  }
  return false;
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
function sectionTerms(section, neutralTenths) {
  const count = section.meetings.length;
  const meanStart = Math.round(section.meetings.reduce((sum, m) => sum + m.start, 0) / count);
  const meanEnd = Math.round(section.meetings.reduce((sum, m) => sum + m.end, 0) / count);
  return {
    morning: Math.max(0, meanStart - MORNING_ANCHOR),
    evening: Math.max(0, EVENING_ANCHOR - meanEnd),
    shortfall: 50 - (ratingTenths(section.rating) ?? neutralTenths),
    clampedMorning: meanStart < MORNING_ANCHOR,
    clampedEvening: meanEnd > EVENING_ANCHOR
  };
}
function selfCost(section, weights, neutralTenths) {
  const own = sectionTerms(section, neutralTenths);
  const lean = weights.mornings * own.morning + weights.evenings * own.evening;
  return lean * COST_PER_LEAN_MINUTE + weights.rating * own.shortfall * COST_PER_RATING_TENTH;
}
function walkSeconds(walkingTime, from, to) {
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
function meetingsByDay(sections, term) {
  const segments = weekSegments(sections.flatMap((section) => section.meetings), term);
  const byDay = new Map;
  for (const section of sections) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day) ?? [];
      list.push({ ...meeting, sectionId: section.id, weeks: segments.maskOf(meeting) });
      byDay.set(meeting.day, list);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return byDay;
}
function costTerms(input) {
  const { sections, walkingTime } = input;
  const byDay = meetingsByDay(sections, input.term);
  const terms = {
    daysOnCampus: byDay.size,
    gapMinutes: 0,
    knownTravelSeconds: 0,
    unknownWalks: 0,
    morningLeanMinutes: 0,
    eveningLeanMinutes: 0,
    clampedMornings: 0,
    clampedEvenings: 0,
    ratingShortfallTenths: 0
  };
  for (const day of OPT_DAYS) {
    const list = byDay.get(day);
    if (!list)
      continue;
    someBackToBack(list, (prev, next) => {
      terms.gapMinutes += Math.max(0, next.start - prev.end);
      const walk = walkSeconds(walkingTime, prev.buildingId, next.buildingId);
      if (walk === null)
        terms.unknownWalks += 1;
      else
        terms.knownTravelSeconds += walk;
      return false;
    });
  }
  for (const section of sections) {
    const own = sectionTerms(section, input.neutralRatingByCourse[section.courseCode] ?? DEFAULT_RATING_TENTHS);
    terms.morningLeanMinutes += own.morning;
    terms.eveningLeanMinutes += own.evening;
    if (own.clampedMorning)
      terms.clampedMornings += 1;
    if (own.clampedEvening)
      terms.clampedEvenings += 1;
    terms.ratingShortfallTenths += own.shortfall;
  }
  return terms;
}
function scoreSchedule(input) {
  const { sections, weights } = input;
  const terms = costTerms(input);
  const meetings = sections.flatMap((section) => section.meetings);
  const ratings = sections.map((section) => ratingTenths(section.rating)).filter((value) => value !== null);
  const credits = sections.reduce((sum, section) => sum + (input.creditsByCourse[section.courseCode] ?? 0), input.fixedCredits ?? 0);
  const breakdown = {
    daysOnCampus: terms.daysOnCampus,
    gapMinutes: terms.gapMinutes,
    walkSeconds: terms.knownTravelSeconds,
    unknownWalks: terms.unknownWalks,
    earliestStart: meetings.length > 0 ? Math.min(...meetings.map((m) => m.start)) : null,
    latestEnd: meetings.length > 0 ? Math.max(...meetings.map((m) => m.end)) : null,
    credits,
    averageRating: ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) / 10 : null
  };
  const cost = weights.fewerDays * COST_PER_DAY * terms.daysOnCampus + weights.compact * COST_PER_GAP_MINUTE * terms.gapMinutes + weights.walking * COST_PER_WALK_SECOND * (terms.knownTravelSeconds + UNKNOWN_WALK_SECONDS * terms.unknownWalks) + COST_PER_LEAN_MINUTE * (weights.mornings * terms.morningLeanMinutes + weights.evenings * terms.eveningLeanMinutes) + weights.rating * COST_PER_RATING_TENTH * terms.ratingShortfallTenths;
  return { cost, breakdown };
}

// src/lib/optimizer/prepare.ts
var DAY_INDEX = new Map(OPT_DAYS.map((day, index) => [day, index]));
function isInteger(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function validateDates(dates, label) {
  const start = dayNumber(dates?.start);
  const end = dayNumber(dates?.end);
  if (start === null || end === null) {
    throw new OptimizerInputError(`${label} has invalid dates ${JSON.stringify(dates)}; expected real YYYY-MM-DD dates`);
  }
  if (start > end)
    throw new OptimizerInputError(`${label} dates end before they start: ${dates.start} to ${dates.end}`);
}
function validateRequest(request, checkDeadline = () => {}) {
  if (request.term !== undefined)
    validateDates(request.term, "term");
  const meetings = [];
  let steps = 0;
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
      const exam = section.exam;
      if (exam !== undefined && exam !== null) {
        if (dayNumber(exam.date) === null)
          throw new OptimizerInputError(`section ${section.id} has an exam on ${JSON.stringify(exam.date)}; expected a real YYYY-MM-DD date`);
        if (!isInteger(exam.start, 0, 24 * 60) || !isInteger(exam.end, 0, 24 * 60) || exam.end <= exam.start) {
          throw new OptimizerInputError(`section ${section.id} has an exam with invalid times ${exam.start}-${exam.end}`);
        }
      }
      for (const meeting of section.meetings) {
        if ((steps++ & 127) === 0)
          checkDeadline();
        meetings.push(meeting);
        if (!DAY_INDEX.has(meeting.day))
          throw new OptimizerInputError(`section ${section.id} meets on unknown day ${meeting.day}`);
        if (!isInteger(meeting.start, 0, 24 * 60) || !isInteger(meeting.end, 0, 24 * 60) || meeting.end <= meeting.start) {
          throw new OptimizerInputError(`section ${section.id} has a meeting with invalid times ${meeting.start}-${meeting.end}`);
        }
        const dates = meeting.dates;
        if (dates === undefined || dates === null)
          continue;
        validateDates(dates, `section ${section.id} meeting`);
        if (request.term === undefined)
          throw new OptimizerInputError("term is required when any meeting has dates");
      }
    }
  }
  weekSegments(meetings, request.term, checkDeadline);
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
    if (block.dates !== undefined && block.dates !== null) {
      if (!Array.isArray(block.dates)) {
        throw new OptimizerInputError(`blocked time ${block.id} has invalid dates: expected an array of ranges`);
      }
      for (const range of block.dates)
        validateDates(range, `blocked time ${block.id}`);
    }
  }
  const fixedCredits = request.fixedCredits ?? 0;
  if (!(Number.isFinite(fixedCredits) && fixedCredits >= 0)) {
    throw new OptimizerInputError(`fixedCredits must be a non-negative number, got ${request.fixedCredits}`);
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
function examsClash(a, b) {
  return !!a && !!b && a.date === b.date && a.start < b.end && b.start < a.end;
}
function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end && (a.weeks & b.weeks) !== 0;
}
function passesTimeConstraints(section, constraints, term = null) {
  const off = new Set(constraints.daysOff);
  for (const meeting of section.meetings) {
    if (constraints.earliestStart !== null && meeting.start < constraints.earliestStart)
      return false;
    if (constraints.latestEnd !== null && meeting.end > constraints.latestEnd)
      return false;
    if (off.has(meeting.day))
      return false;
    for (const block of constraints.blocked) {
      if (blockConflicts(block, meeting, term))
        return false;
    }
  }
  return true;
}
function blockConflicts(block, meeting, term) {
  if (block.day !== meeting.day)
    return false;
  if (meeting.start >= block.end || block.start >= meeting.end)
    return false;
  const ranges = block.dates;
  if (!ranges || ranges.length === 0)
    return true;
  const own = meeting.dates ?? term;
  if (!own)
    return true;
  const ownStart = dayNumber(own.start);
  const ownEnd = dayNumber(own.end);
  if (ownStart === null || ownEnd === null)
    return true;
  const weekday = OPT_DAYS.indexOf(block.day);
  for (const range of ranges) {
    const start = dayNumber(range.start);
    const end = dayNumber(range.end);
    if (start === null || end === null)
      continue;
    const first = Math.max(start, ownStart);
    const last = Math.min(end, ownEnd);
    if (first > last)
      continue;
    const firstMatch = first + (weekday - (first + 3) % 7 + 7) % 7;
    if (firstMatch <= last)
      return true;
  }
  return false;
}
var datesKey = (m) => m.dates ? `${m.dates.start}/${m.dates.end}` : "";
function timeSignatureOf(meetings) {
  return meetings.map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}~${datesKey(m)}`).sort().join(",");
}
function fullSignatureOf(meetings) {
  return meetings.map((m) => `${DAY_INDEX.get(m.day)}:${m.start}-${m.end}~${datesKey(m)}@${m.buildingId ?? ""}`).sort().join(",");
}
function allowedSections(course, request) {
  const excluded = new Set(request.excluded);
  const locked = request.locks[course.code];
  return course.sections.filter((section) => !excluded.has(section.id) && (locked === undefined || section.id === locked));
}
function minDifferentCourses(request) {
  let variable = 0;
  for (const course of request.courses) {
    const signatures = new Set(allowedSections(course, request).filter((section) => passesTimeConstraints(section, request.constraints, request.term ?? null)).map((section) => timeSignatureOf(section.meetings)));
    if (signatures.size >= 2)
      variable += 1;
  }
  return Math.max(1, Math.min(2, variable));
}
function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
var MAX_FILL_TIMES = 256;
var MAX_FLOOR_BUILDINGS = 64;

class PrepareBudgetExhausted extends Error {
  constructor() {
    super("optimizer: time budget ran out while preparing");
  }
}
function prepare(request, deadline = Number.POSITIVE_INFINITY, now = () => performance.now(), options = {}) {
  const checkDeadline = () => {
    if (deadline !== Number.POSITIVE_INFINITY && now() > deadline)
      throw new PrepareBudgetExhausted;
  };
  validateRequest(request, checkDeadline);
  const { constraints, weights } = request;
  const sortedCourses = [...request.courses].sort((a, b) => compareIds(a.code, b.code));
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
  const allowedByCourse = sortedCourses.map((course) => allowedSections(course, request).filter((section) => passesTimeConstraints(section, constraints, request.term ?? null)));
  const segments = weekSegments(allowedByCourse.flatMap((list) => list.flatMap((section) => section.meetings)), request.term, checkDeadline);
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
    if (from < 0 || to < 0)
      return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };
  const tightPair = (prev, next) => bufferMinutes !== null && !(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0) && next.start - prev.end < globalMinDuration && !transferFits(prev, next, walkOf(prev.building, next.building), bufferMinutes);
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
      const meetings = section.meetings.map((m) => ({ day: DAY_INDEX.get(m.day), start: m.start, end: m.end, building: intern(m.buildingId), weeks: segments.maskOf(m) })).sort((a, b) => a.day - b.day || a.start - b.start);
      let selfBroken = false;
      for (let i = 0;i < meetings.length && !selfBroken; i += 1) {
        for (let j = i + 1;j < meetings.length; j += 1) {
          if (overlaps(meetings[i], meetings[j])) {
            selfBroken = true;
            break;
          }
        }
      }
      if (selfBroken || someBackToBack(meetings, tightPair))
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
    const ordered = (options.keepTwins ? kept : dropTwins(kept, walkingMatters2)).sort((a, b) => a.self - b.self || compareIds(a.section.id, b.section.id));
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
  const fill = t > MAX_FILL_TIMES ? null : courses.map((course) => OPT_DAYS.map((_, day) => {
    checkDeadline();
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
      if ((i & 31) === 0)
        checkDeadline();
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
  if (nodes > MAX_FLOOR_BUILDINGS)
    walkFloor.fill(0);
  for (let via = 0;via < nodes && nodes <= MAX_FLOOR_BUILDINGS; via += 1) {
    checkDeadline();
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
    weekSegments: segments.count,
    weights,
    totalCredits: sortedCourses.reduce((sum, course) => sum + course.credits, request.fixedCredits ?? 0),
    maxCredits: constraints.maxCredits,
    minDifferentCourses: minDifferentCourses(request),
    creditsByCourse,
    neutralRatingByCourse
  };
}
function incompatible(a, b, tightPair) {
  if (examsClash(a.section.exam, b.section.exam))
    return true;
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (overlaps(ma, mb))
        return true;
    }
  }
  if ((a.dayMask & b.dayMask) === 0)
    return false;
  const merged = [
    ...a.meetings.map((meeting) => ({ ...meeting, from: 0 })),
    ...b.meetings.map((meeting) => ({ ...meeting, from: 1 }))
  ].sort((x, y) => x.day - y.day || x.start - y.start);
  return someBackToBack(merged, (prev, next) => prev.from !== next.from && tightPair(prev, next));
}
function dropTwins(candidates, walkingMatters) {
  const best = new Map;
  for (const candidate of candidates) {
    const exam = candidate.section.exam;
    const examKey = exam ? `#${exam.date}/${exam.start}-${exam.end}` : "";
    const key = (walkingMatters ? fullSignatureOf(candidate.section.meetings) : timeSignatureOf(candidate.section.meetings)) + examKey;
    const current = best.get(key);
    if (!current || candidate.self < current.self || candidate.self === current.self && compareIds(candidate.section.id, current.section.id) < 0) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

// src/lib/optimizer/search.ts
var DAY_COUNT = OPT_DAYS.length;

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
  const dayLists = Array.from({ length: DAY_COUNT }, () => []);
  let anyCandidateDays = 0;
  for (const candidate of prepared.candidates)
    anyCandidateDays |= candidate.dayMask;
  const dayEnd = 32 - Math.clz32(anyCandidateDays);
  let daysUsed = 0;
  let selfSum = 0;
  let assignedCount = 0;
  const previous = options.previous;
  const same = new Int32Array(previous.length);
  const minDifferent = options.minDifferent;
  const walkOf = (from, to) => {
    if (from < 0 || to < 0)
      return null;
    const seconds = walk[from * buildingCount + to];
    return seconds < 0 ? null : seconds;
  };
  const { times, timeIndex, fill, walkFloor } = prepared;
  const floorStride = buildingCount + 1;
  const timeCount = times.length;
  const pairsMatter = weights.compact > 0 || weights.walking > 0 || bufferSeconds !== null;
  const oneSegment = prepared.weekSegments === 1 && prepared.candidates.every((c) => c.meetings.every((m) => m.weeks !== 0));
  function weeklyOrFixedDayCost(day, remaining, remainingCount) {
    const list = dayLists[day];
    let gap = 0;
    let walkCost = 0;
    for (let i = 0;i + 1 < list.length; i += 1) {
      const prev = list[i];
      let between = 0;
      for (let j = i + 1;j < list.length; j += 1) {
        const next = list[j];
        const backToBack = (prev.weeks & next.weeks & ~between) !== 0;
        between |= next.weeks;
        if (backToBack) {
          const window = next.start - prev.end;
          const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
          let filled = 0;
          if (fill === null)
            filled = remainingCount > 0 ? window : 0;
          else
            for (let r = 0;r < remainingCount && filled < window; r += 1)
              filled += fill[remaining[r]][day][cell];
          if (filled > 0) {
            if (oneSegment) {
              if (filled < window)
                gap += window - filled;
              if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
                walkCost += walkFloor[(prev.building < 0 ? buildingCount : prev.building) * floorStride + (next.building < 0 ? buildingCount : next.building)];
              }
            }
          } else {
            gap += window;
            if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
              const seconds = walkOf(prev.building, next.building);
              walkCost += seconds ?? UNKNOWN_WALK_SECONDS;
              if (bufferSeconds !== null && window * 60 < (seconds ?? UNKNOWN_WALK_SECONDS) + bufferSeconds)
                return -1;
            }
          }
        }
        if ((prev.weeks & ~between) === 0)
          break;
      }
    }
    return weights.compact * COST_PER_GAP_MINUTE * gap + weights.walking * COST_PER_WALK_SECOND * walkCost;
  }
  const dayWeeks = new Int32Array(DAY_COUNT);
  const mixedDays = new Uint8Array(DAY_COUNT);
  if (!oneSegment) {
    const firstMasks = new Array(DAY_COUNT);
    for (const c of prepared.candidates)
      for (const m of c.meetings) {
        if (firstMasks[m.day] === undefined)
          firstMasks[m.day] = m.weeks;
        else if (firstMasks[m.day] !== m.weeks)
          mixedDays[m.day] = 1;
        dayWeeks[m.day] |= m.weeks;
      }
  }
  function segmentDayCost(day, mask, remaining, count) {
    let prev;
    let cost = 0;
    for (const next of dayLists[day]) {
      if ((next.weeks & mask) === 0)
        continue;
      if (prev) {
        const window = next.start - prev.end;
        const cell = timeIndex[prev.end] * timeCount + timeIndex[next.start];
        let filled = fill === null && count > 0 ? window : 0;
        if (fill !== null)
          for (let r = 0;r < count && filled < window; r += 1)
            filled += fill[remaining[r]][day][cell];
        cost += weights.compact * COST_PER_GAP_MINUTE * Math.max(0, window - filled);
        if (!(prev.building >= 0 && prev.building === next.building && walkOf(prev.building, next.building) === 0)) {
          let walking;
          if (filled === 0) {
            walking = walkOf(prev.building, next.building) ?? UNKNOWN_WALK_SECONDS;
            if (bufferSeconds !== null && window * 60 < walking + bufferSeconds)
              return -1;
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
  function calendarDayCost(day, remaining, count) {
    if (dayLists[day].length < 2)
      return 0;
    if (!mixedDays[day])
      return segmentDayCost(day, dayWeeks[day], remaining, count);
    const fixed = weeklyOrFixedDayCost(day, remaining, count);
    if (fixed < 0 || count === 0)
      return fixed;
    let bound = fixed;
    for (let bits = dayWeeks[day];bits !== 0; bits &= bits - 1) {
      const cost = segmentDayCost(day, bits & -bits, remaining, count);
      if (cost < 0)
        return -1;
      bound = Math.max(bound, cost);
    }
    return bound;
  }
  const dayCost = oneSegment ? weeklyOrFixedDayCost : calendarDayCost;
  const noRemaining = new Int32Array(0);
  function completeCost() {
    let total = 0;
    for (let d = 0;d < dayEnd; d += 1) {
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
    dayStack.push(new Float64Array(DAY_COUNT));
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
    for (let d = 0;d < dayEnd; d += 1) {
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
      if (dayPrice === 0 || mostNewDays === dayEnd)
        continue;
      let fewestNew = DAY_COUNT + 1;
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
      for (let d = 0;d < dayEnd; d += 1) {
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
    if (options.collect) {
      best = options.collect(leaf);
      return;
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
  function segmentOutside(day, mask, all, count, alive) {
    if (fill === null)
      return 0;
    let spanStart = -1;
    let spanEnd = -1;
    for (const m of dayLists[day]) {
      if ((m.weeks & mask) === 0)
        continue;
      if (spanStart < 0)
        spanStart = m.start;
      spanEnd = m.end;
    }
    if (spanStart < 0)
      return 0;
    let right = 0;
    let left = 0;
    for (let r = 0;r < count; r += 1) {
      const u = all[r];
      if (!forcedOn(u, day, alive))
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
          let meets = false;
          for (const m of candidate.meetings) {
            if (m.day !== day || (m.weeks & mask) === 0)
              continue;
            meets = true;
            let stretchRight = 0;
            let stretchLeft = 0;
            if (m.start >= spanEnd) {
              const cell = timeIndex[spanEnd] * timeCount + timeIndex[m.start];
              let filled = 0;
              for (let q = 0;q < count; q += 1)
                if (all[q] !== u)
                  filled += fill[all[q]][day][cell];
              stretchRight = Math.max(0, m.start - spanEnd - filled);
            } else if (m.end <= spanStart) {
              const cell = timeIndex[m.end] * timeCount + timeIndex[spanStart];
              let filled = 0;
              for (let q = 0;q < count; q += 1)
                if (all[q] !== u)
                  filled += fill[all[q]][day][cell];
              stretchLeft = Math.max(0, spanStart - m.end - filled);
            }
            extRight = Math.min(extRight, stretchRight);
            extLeft = Math.min(extLeft, stretchLeft);
          }
          if (!meets) {
            minRight = 0;
            minLeft = 0;
            break;
          }
          minRight = Math.min(minRight, extRight);
          minLeft = Math.min(minLeft, extLeft);
        }
      }
      if (minRight !== Number.POSITIVE_INFINITY)
        right = Math.max(right, minRight);
      if (minLeft !== Number.POSITIVE_INFINITY)
        left = Math.max(left, minLeft);
    }
    return right + left;
  }
  function calendarNodeDayCost(day, all, count, alive) {
    let bound = mixedDays[day] ? weeklyOrFixedDayCost(day, all, count) : 0;
    if (bound < 0)
      return -1;
    let bits = dayWeeks[day];
    while (bits !== 0) {
      const mask = mixedDays[day] ? bits & -bits : bits;
      const inside = segmentDayCost(day, mask, all, count);
      if (inside < 0)
        return -1;
      const outside = segmentOutside(day, mask, all, count, alive);
      bound = Math.max(bound, inside + weights.compact * COST_PER_GAP_MINUTE * outside);
      if (!mixedDays[day])
        break;
      bits &= bits - 1;
    }
    return bound;
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
      let fewestNew = DAY_COUNT + 1;
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
    for (let d = 0;d < dayEnd && weights.compact > 0; d += 1) {
      if (!oneSegment) {
        const dated = calendarNodeDayCost(d, all, count, alive);
        if (dated < 0)
          return -1;
        pairs += dated;
        continue;
      }
      const inside = dayCost(d, all, count);
      if (inside < 0)
        return -1;
      pairs += inside;
      const list = dayLists[d];
      if (list.length === 0 || fill === null || !oneSegment)
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
    for (let d = 0;d < dayEnd; d += 1)
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
  if (hasExams(request))
    members.push({ kind: "exams" });
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
function hasExams(request) {
  return request.courses.some((course) => course.sections.some((section) => section.exam));
}
function restrictTo(request, members) {
  const keys = new Set(members.map(memberKey));
  const kept = request.courses.filter((course) => keys.has(`course:${course.code}`));
  const courses = keys.has("exams") || !hasExams(request) ? kept : kept.map((course) => ({ ...course, sections: course.sections.map((section) => section.exam ? { ...section, exam: null } : section) }));
  const keptCodes = new Set(courses.map((course) => course.code));
  const sectionCourse = new Map;
  for (const course of courses)
    for (const section of course.sections)
      sectionCourse.set(section.id, course.code);
  const c = request.constraints;
  return {
    ...request,
    courses,
    locks: Object.fromEntries(Object.entries(request.locks).filter(([code]) => keptCodes.has(code) && keys.has(`lock:${code}`))),
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
var DAY_LETTER = { Mon: "M", Tue: "T", Wed: "W", Thu: "Th", Fri: "F", Sat: "Sa", Sun: "Su" };
var DAY_PLURAL = {
  Mon: "Mondays",
  Tue: "Tuesdays",
  Wed: "Wednesdays",
  Thu: "Thursdays",
  Fri: "Fridays",
  Sat: "Saturdays",
  Sun: "Sundays"
};
var DAY_NAME = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday"
};
function describePattern(section) {
  const byStart = new Map;
  for (const meeting of section.meetings)
    byStart.set(meeting.start, [...byStart.get(meeting.start) ?? [], meeting.day]);
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, days]) => {
    const ordered = OPT_DAYS.filter((day) => days.includes(day));
    return `${ordered.map((day) => DAY_LETTER[day]).join("")} ${formatClock(start)}`;
  }).join(", ");
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rangeOf(request, section) {
  const ranges = section.meetings.map((meeting) => meeting.dates ?? request.term ?? null);
  const known = ranges.filter((range) => range !== null);
  if (known.length !== ranges.length)
    return null;
  return {
    start: known.reduce((min, range) => range.start < min ? range.start : min, known[0].start),
    end: known.reduce((max, range) => range.end > max ? range.end : max, known[0].end)
  };
}
function datesLabel(request, range) {
  if (request.term && range.start === request.term.start && range.end === request.term.end)
    return "full term";
  const day = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
  return range.start === range.end ? day(range.start) : `${day(range.start)}–${day(range.end)}`;
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
var WEEKDAY_SHORT = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
function examClock(minutes, suffix) {
  const hours = Math.floor(minutes / 60);
  const text = `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, "0")}`;
  return suffix ? `${text} ${hours >= 12 ? "PM" : "AM"}` : text;
}
function examTimes(start, end) {
  return start < 12 * 60 === end < 12 * 60 ? `${examClock(start, false)} to ${examClock(end, true)}` : `${examClock(start, true)} to ${examClock(end, true)}`;
}
function examLabel(exam) {
  const weekday = WEEKDAY_SHORT[(dayNumber(exam.date) ?? 0) % 7];
  const date = `${MONTHS[Number(exam.date.slice(5, 7)) - 1]} ${Number(exam.date.slice(8, 10))}`;
  return `${weekday}, ${date}, ${examTimes(exam.start, exam.end)}`;
}
function examPair(a, b) {
  if (a.date === b.date && a.start === b.start && a.end === b.end)
    return `both ${examLabel(a)}`;
  return `${examLabel(a)} and ${examTimes(b.start, b.end)}`;
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
  if (has("exams"))
    phrases.push("without overlapping finals");
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
  const rangeKeys = new Set(sub.courses.flatMap((course) => course.sections.map((section) => JSON.stringify(rangeOf(request, section)))));
  const dated = rangeKeys.size > 1;
  const datesOf = (section) => {
    const range = rangeOf(request, section);
    return range ? datesLabel(request, range) : null;
  };
  const pattern = (section) => {
    const dates = dated ? datesOf(section) : null;
    return dates ? `${describePattern(section)}, ${dates}` : describePattern(section);
  };
  if (members.some((member) => member.kind === "maxCredits")) {
    const fixed = request.fixedCredits ?? 0;
    const credits = request.courses.filter((course) => codes.includes(course.code)).reduce((sum, course) => sum + course.credits, fixed);
    const parts = [...codes, ...fixed > 0 ? [`your other ${fixed} credits`] : []];
    const subject = codes.length > 0 ? joinList(parts) : "Your other courses";
    return `${subject} add up to ${credits} credits, over your ${request.constraints.maxCredits}-credit limit.`;
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
      return `your locked ${code} section (${pattern(sectionById.get(lockedId))})`;
    return code;
  };
  if (codes.length === 1) {
    const code = codes[0];
    if (locked.has(code))
      return `Your locked ${code} section (${pattern(sectionById.get(locked.get(code)))}) doesn't fit${where}.`;
    if (conditions.length === 0)
      return `No section of ${code} works: each one's own meetings clash.`;
    return `No section of ${code} fits${where}.`;
  }
  if (codes.length === 2) {
    const [a, b] = codes;
    const onlyA = onlySection(a);
    const onlyB = onlySection(b);
    const examA = onlyA?.exam;
    const examB = onlyB?.exam;
    if (onlyA && onlyB && examA && examB && conditions.length === 1 && members.some((member) => member.kind === "exams")) {
      const named = (code, only) => locked.has(code) ? describe(code) : `${code} (${pattern(only)})`;
      return `${named(a, onlyA)} and ${named(b, onlyB)} have overlapping finals (${examPair(examA, examB)}).`.replace(/^./, (s) => s.toUpperCase());
    }
    if (conditions.length === 0) {
      if (onlyA && onlyB) {
        if (locked.has(a) || locked.has(b)) {
          const named = (code, only) => locked.has(code) ? describe(code) : `${code} (${pattern(only)})`;
          return `${named(a, onlyA)} and ${named(b, onlyB)} overlap.`.replace(/^./, (s) => s.toUpperCase());
        }
        const datesA = dated ? datesOf(onlyA) : null;
        const datesB = dated ? datesOf(onlyB) : null;
        const both = datesA && datesB ? `: ${describePattern(onlyA)} (${datesA}) and ${describePattern(onlyB)} (${datesB})` : ` (${describePattern(onlyA)} and ${describePattern(onlyB)})`;
        return `${describe(a)} and ${describe(b)} overlap${both}.`.replace(/^./, (s) => s.toUpperCase());
      }
      if (onlyB)
        return `Every section of ${a} overlaps ${locked.has(b) ? describe(b) : `${b}'s only section (${pattern(onlyB)})`}.`;
      if (onlyA)
        return `Every section of ${b} overlaps ${locked.has(a) ? describe(a) : `${a}'s only section (${pattern(onlyA)})`}.`;
      return `Every section of ${a} overlaps every section of ${b}.`;
    }
    if (onlyB && !onlyA)
      return `No section of ${a} fits alongside ${locked.has(b) ? describe(b) : `${b} (${pattern(onlyB)})`}${where}.`;
    if (onlyA && !onlyB)
      return `No section of ${b} fits alongside ${locked.has(a) ? describe(a) : `${a} (${pattern(onlyA)})`}${where}.`;
    return `No pair of ${a} and ${b} sections fits together${where}.`;
  }
  const names = codes.map(describe);
  const overlap = members.some((member) => member.kind === "exams") ? "two classes or two finals that overlap" : "a clash";
  return `${joinList(names)} can't all fit together${where}: every combination has ${overlap}.`.replace(/^./, (s) => s.toUpperCase());
}
function fallbackSentence(request, members) {
  const codes = members.filter((m) => m.kind === "course").map((m) => m.courseCode);
  const locks = members.filter((m) => m.kind === "lock").map((m) => `your ${m.courseCode} lock`);
  const parts = [...codes, ...locks, ...conditionPhrases(request, members.filter((m) => m.kind !== "exams"))];
  if (members.some((m) => m.kind === "exams"))
    parts.push("finals that don't overlap");
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
        const total = request.courses.reduce((sum, course) => sum + course.credits, request.fixedCredits ?? 0);
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
      case "exams":
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
    term: request.term,
    creditsByCourse: prepared.creditsByCourse,
    fixedCredits: request.fixedCredits,
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

// src/lib/optimizer/enumerate.ts
var MAX_LIST_LIMIT = 2000;
var DEFAULT_LIST_LIMIT = 500;
var DEFAULT_RANK_NODES = 400000;
var DEFAULT_COUNT_NODES = 1e6;
var DEFAULT_EXPLAIN_BUDGET_MS2 = 250;
var NO_WEIGHTS = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
function positiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new OptimizerInputError(`${label} must be an integer 1..${max}, got ${value}`);
  return value;
}
function enumerateSchedules(request) {
  const { limit: askedLimit, rankNodes: askedRank, countNodes: askedCount, timeBudgetMs, ...rest } = request;
  const limit = positiveInteger(askedLimit ?? DEFAULT_LIST_LIMIT, "limit", MAX_LIST_LIMIT);
  const rankNodes = positiveInteger(askedRank ?? DEFAULT_RANK_NODES, "rankNodes");
  const countNodes = positiveInteger(askedCount ?? DEFAULT_COUNT_NODES, "countNodes");
  const engineRequest = { ...rest };
  const now = engineRequest.now ?? (() => performance.now());
  const started = now();
  const deadline = timeBudgetMs === undefined ? Number.POSITIVE_INFINITY : started + timeBudgetMs;
  let prepared;
  try {
    prepared = prepare(engineRequest, deadline, now, { keepTwins: true });
  } catch (error) {
    if (!(error instanceof PrepareBudgetExhausted))
      throw error;
    return { status: "timeout", schedules: [], total: 0, totalExact: false, stats: { rankNodes: 0, countNodes: 0, elapsedMs: now() - started, candidates: {} } };
  }
  const kept = [];
  const collect = (leaf) => {
    if (kept.length === limit && !leafBefore(leaf, kept[limit - 1]))
      return kept[limit - 1];
    let index = kept.length;
    while (index > 0 && leafBefore(leaf, kept[index - 1]))
      index -= 1;
    kept.splice(index, 0, leaf);
    if (kept.length > limit)
      kept.pop();
    return kept.length === limit ? kept[limit - 1] : null;
  };
  const rankBudget = { deadline, maxNodes: rankNodes, now, nodes: 0 };
  const ranked = search(prepared, rankBudget, { previous: [], minDifferent: 0, stopAtFirst: false, incumbent: null, collect });
  const countBudget = { deadline, maxNodes: countNodes, now, nodes: 0 };
  const stats = () => ({
    rankNodes: rankBudget.nodes,
    countNodes: countBudget.nodes,
    elapsedMs: now() - started,
    candidates: Object.fromEntries(prepared.courses.map((course) => [course.code, course.candidates.length]))
  });
  if (kept.length === 0) {
    if (!ranked.complete)
      return { status: "timeout", schedules: [], total: 0, totalExact: false, stats: stats() };
    const explanation = explainInfeasible(engineRequest, engineRequest.explainBudgetMs ?? DEFAULT_EXPLAIN_BUDGET_MS2, now);
    return { status: "infeasible", schedules: [], total: 0, totalExact: true, explanation, stats: stats() };
  }
  let total = kept.length;
  let totalExact = ranked.complete;
  if (!ranked.complete || kept.length === limit) {
    let count = 0;
    const counted = search({ ...prepared, weights: NO_WEIGHTS }, countBudget, {
      previous: [],
      minDifferent: 0,
      stopAtFirst: false,
      incumbent: null,
      collect: () => {
        count += 1;
        return null;
      }
    });
    total = Math.max(count, kept.length);
    totalExact = counted.complete;
  }
  const proven = ranked.complete || totalExact && total === kept.length;
  const schedules = kept.map((leaf) => toRanked(engineRequest, prepared, leaf, proven));
  return { status: "listed", schedules, total, totalExact, stats: stats() };
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
var BROWSE_LIMIT = 500;
var BROWSE_BUDGET_MS = 4000;
function browseRequest(plain) {
  const { walking, k: _k, ...rest } = plain;
  return { ...rest, walkingTime: walkingFromTable(walking), limit: BROWSE_LIMIT, timeBudgetMs: BROWSE_BUDGET_MS };
}
function runBrowseJob(job, deps) {
  try {
    deps.post({ id: job.id, phase: "browse", result: deps.enumerate(browseRequest(job.request)), settled: true });
  } catch (error) {
    deps.post({ id: job.id, phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

// src/lib/optimizer/worker/optimize.worker.ts
var scope = self;
scope.onmessage = (event) => {
  const job = event.data;
  if ("kind" in job && job.kind === "browse") {
    runBrowseJob(job, { enumerate: enumerateSchedules, post: (reply) => scope.postMessage(reply) });
    return;
  }
  runJob(job, { optimize, post: (reply) => scope.postMessage(reply) });
};
