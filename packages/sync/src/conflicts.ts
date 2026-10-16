import {
  AcademicRecordBodySchema, MAX_CALENDARS, PreferencesBodySchema, ScheduleBodySchema,
  type AcademicRecordBody, type PreferencesBody, type DocumentKind,
} from '@untangle/contracts/documents';
import type { Body } from './store';

/** Object key order has no meaning in document bodies. Array order is retained. */
export function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, i) => equal(value, right[i]));
  }
  const a = Object.entries(left).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(right).sort(([x], [y]) => x.localeCompare(y));
  return equal(a, b);
}

export function mergePreferences(base: PreferencesBody, local: PreferencesBody, latest: PreferencesBody): PreferencesBody {
  assertInstitution(base, local, latest);
  const choose = <T>(before: T, mine: T, theirs: T): T => equal(before, mine) ? theirs : mine;
  // Time bounds move together because independently valid edits can form an invalid range.
  const [earliestStart, latestEnd] = choose(
    [base.constraints.earliestStart, base.constraints.latestEnd],
    [local.constraints.earliestStart, local.constraints.latestEnd],
    [latest.constraints.earliestStart, latest.constraints.latestEnd],
  );
  // The goal names the weights' preset; these values must travel together.
  const preset = choose({ goal: base.goal, weights: base.weights }, { goal: local.goal, weights: local.weights }, { goal: latest.goal, weights: latest.weights });
  const constraints = { ...latest.constraints, earliestStart, latestEnd };
  function group<K extends keyof PreferencesBody['constraints']>(key: K) {
    constraints[key] = choose(base.constraints[key], local.constraints[key], latest.constraints[key]);
  }
  group('daysOff'); group('blocked'); group('maxCredits'); group('walkingBufferMinutes');
  group('excludedSections'); group('openSeatsOnly'); group('otherSites');
  const calendars = mergeCalendars(base.calendars ?? [], local.calendars ?? [], latest.calendars ?? []);
  return PreferencesBodySchema.parse({ institutionId: latest.institutionId, ...preset, constraints, ...(calendars.length ? { calendars } : {}) });
}

type Calendar = NonNullable<PreferencesBody['calendars']>[number];

/**
 * Calendars settle one by one, three-way, so connecting a calendar on the
 * phone and another on the laptop keeps both. A calendar only one side
 * changed (connected, refreshed, renamed or removed) takes that side; one
 * both changed takes this client's side, as every preferences group does.
 * The latest's order holds, with this side's new calendars after it.
 */
function mergeCalendars(base: readonly Calendar[], local: readonly Calendar[], latest: readonly Calendar[]): Calendar[] {
  const byId = (list: readonly Calendar[]) => new Map(list.map((calendar) => [calendar.id, calendar]));
  const before = byId(base), mine = byId(local), theirs = byId(latest);
  const ids = [...new Set([...latest.map((calendar) => calendar.id), ...local.map((calendar) => calendar.id)])];
  const merged = ids.flatMap((id) => {
    const was = before.get(id) ?? null, now = mine.get(id) ?? null;
    const chosen = equal(was, now) ? (theirs.get(id) ?? null) : now;
    return chosen ? [chosen] : [];
  });
  // Two devices each connecting calendars offline can pass the limit together. A merge the
  // schema refuses would stop syncing for good, so this side's newest calendars are dropped;
  // the student connects them again. The UI's limit makes this rare.
  return merged.slice(0, MAX_CALENDARS);
}

export type CourseFacts = {
  status: AcademicRecordBody['courseStatuses'][string] | null;
  manualCredit: boolean;
  records: AcademicRecordBody['transcriptRecords'];
};
export type AcademicQuestion =
  | { kind: 'course'; course: string; base: CourseFacts; local: CourseFacts; latest: CourseFacts }
  | { kind: 'major'; base: AcademicRecordBody['major']; local: AcademicRecordBody['major']; latest: AcademicRecordBody['major'] }
  | { kind: 'catalogId'; base: AcademicRecordBody['catalogId']; local: AcademicRecordBody['catalogId']; latest: AcademicRecordBody['catalogId'] }
  | { kind: 'transcript-id'; id: string };
export type AcademicMerge = { body: AcademicRecordBody; questions: AcademicQuestion[] };

function assertInstitution(...bodies: { institutionId: string }[]) {
  if (bodies.some((body) => body.institutionId !== bodies[0].institutionId)) throw new Error('Cannot merge documents from different institutions.');
}

export function mergeAcademicRecord(base: AcademicRecordBody, local: AcademicRecordBody, latest: AcademicRecordBody): AcademicMerge {
  assertInstitution(base, local, latest);
  const courses = (body: AcademicRecordBody) => [...Object.keys(body.courseStatuses), ...body.manualCredit, ...body.transcriptRecords.map((row) => row.code)];
  const facts = (body: AcademicRecordBody, course: string): CourseFacts => ({
    status: Object.hasOwn(body.courseStatuses, course) ? body.courseStatuses[course] : null,
    manualCredit: body.manualCredit.includes(course),
    records: body.transcriptRecords.filter((row) => row.code === course).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const body: AcademicRecordBody = { ...latest, courseStatuses: {}, manualCredit: [], transcriptRecords: [] };
  const questions: AcademicQuestion[] = [];
  for (const course of [...new Set([...courses(base), ...courses(local), ...courses(latest)])].sort()) {
    const before = facts(base, course), mine = facts(local, course), theirs = facts(latest, course);
    const conflict = !equal(mine, before) && !equal(theirs, before) && !equal(mine, theirs);
    if (conflict) questions.push({ kind: 'course', course, base: before, local: mine, latest: theirs });
    // Unanswered questions keep the latest decision in the preview, never the stale offline value.
    const selected = conflict || equal(mine, before) ? theirs : mine;
    if (selected.status !== null) Object.defineProperty(body.courseStatuses, course, { value: selected.status, enumerable: true, configurable: true, writable: true });
    if (selected.manualCredit) body.manualCredit.push(course);
    body.transcriptRecords.push(...selected.records);
  }
  for (const key of ['major', 'catalogId'] as const) {
    if (!equal(local[key], base[key]) && !equal(latest[key], base[key]) && !equal(local[key], latest[key])) {
      if (key === 'major') questions.push({ kind: key, base: base.major, local: local.major, latest: latest.major });
      else questions.push({ kind: key, base: base.catalogId, local: local.catalogId, latest: latest.catalogId });
    } else if (!equal(local[key], base[key])) {
      if (key === 'major') body.major = local.major;
      else body.catalogId = local.catalogId;
    }
  }
  // Moving a row to a different course on one side can otherwise duplicate its id.
  const ids = new Set<string>();
  for (const row of body.transcriptRecords) {
    if (ids.has(row.id)) questions.push({ kind: 'transcript-id', id: row.id });
    ids.add(row.id);
  }
  return { body, questions };
}

export type ConflictResolution =
  | { kind: 'merged'; body: Body }
  | { kind: 'schedule'; choices: readonly ['use-latest', 'keep-as-another-schedule', 'reapply-chosen-edits'] }
  | { kind: 'academic-record'; body: AcademicRecordBody; questions: AcademicQuestion[] }
  | { kind: 'delete-versus-edit' }
  | { kind: 'immutable-version' };

export function resolveConflict(kind: DocumentKind, base: Body | null, local: Body | null, latest: Body | null): ConflictResolution {
  if (kind === 'version') return { kind: 'immutable-version' };
  if (local === null || latest === null) return { kind: 'delete-versus-edit' };
  if (kind === 'schedule') {
    ScheduleBodySchema.parse(local); ScheduleBodySchema.parse(latest);
    return { kind, choices: ['use-latest', 'keep-as-another-schedule', 'reapply-chosen-edits'] };
  }
  if (kind === 'preferences') {
    const mine = PreferencesBodySchema.parse(local), theirs = PreferencesBodySchema.parse(latest);
    assertInstitution(mine, theirs);
    // A first write changed every group from absence. No field is borrowed from an unseen base.
    return { kind: 'merged', body: base === null ? mine : mergePreferences(PreferencesBodySchema.parse(base), mine, theirs) };
  }
  const mine = AcademicRecordBodySchema.parse(local);
  // With no prior document, each course starts absent; overlapping different decisions still ask.
  const before = base === null
    ? AcademicRecordBodySchema.parse({ institutionId: mine.institutionId, courseStatuses: {}, transcriptRecords: [], manualCredit: [], major: null, catalogId: null })
    : AcademicRecordBodySchema.parse(base);
  const merged = mergeAcademicRecord(before, mine, AcademicRecordBodySchema.parse(latest));
  return merged.questions.length ? { kind, ...merged } : { kind: 'merged', body: AcademicRecordBodySchema.parse(merged.body) };
}
