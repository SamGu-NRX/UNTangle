import { expect, test } from 'bun:test';
import { AcademicRecordBodySchema } from '@untangle/contracts/documents';
import { mergeAcademicRecord, mergePreferences, resolveConflict } from '../src/conflicts';
import { academic, preferences, schedule } from './fixtures';

test('preference bounds move together while unrelated groups take the latest value', () => {
  const base = preferences(); base.constraints.earliestStart = 480; base.constraints.latestEnd = 1020;
  const mine = preferences(); mine.constraints.earliestStart = 900; mine.constraints.latestEnd = 1020;
  const theirs = preferences(); theirs.constraints.earliestStart = 480; theirs.constraints.latestEnd = 600; theirs.constraints.daysOff = ['Fri']; theirs.weights.walking = 4;
  const merged = mergePreferences(base, mine, theirs);
  expect(merged.constraints).toEqual({ ...preferences().constraints, earliestStart: 900, latestEnd: 1020, daysOff: ['Fri'] });
  expect(merged.weights.walking).toBe(4);
});

test('both sides changing a preference group chooses the client, including the preset and weights together', () => {
  const base = preferences(), mine = preferences(), theirs = preferences();
  mine.goal = 'clusterMorning'; mine.weights.mornings = 4; mine.constraints.maxCredits = 12;
  theirs.weights.walking = 4; theirs.constraints.maxCredits = 20;
  expect(mergePreferences(base, mine, theirs)).toEqual(mine);
});

test('an unchanged preference draft takes every latest group', () => {
  const base = preferences(), latest = preferences();
  latest.constraints.daysOff = ['Mon']; latest.constraints.blocked = [{ id: 'work', label: 'Work', day: 'Tue', start: 600, end: 700 }];
  latest.constraints.maxCredits = 18; latest.constraints.walkingBufferMinutes = 20;
  latest.constraints.excludedSections = ['s']; latest.constraints.openSeatsOnly = true; latest.constraints.otherSites = true;
  latest.goal = 'minimizeDistance'; latest.weights.walking = 4;
  expect(mergePreferences(base, preferences(), latest)).toEqual(latest);
});

const calendar = (id: string, name = id, dates = ['2027-01-12']) => ({
  id, name, sealedUrl: `cf1.key.iv.${id}`, termId: 'spring-2027', checkedAt: '2026-10-15T12:00:00.000Z',
  busy: [{ start: 900, end: 1080, dates }], allDayDates: [], countAllDay: false,
});

test('calendars connected on two devices are both kept', () => {
  const base = preferences(), mine = preferences(), theirs = preferences();
  mine.calendars = [calendar('cal-phone')];
  theirs.calendars = [calendar('cal-laptop')];
  expect(mergePreferences(base, mine, theirs).calendars?.map((c) => c.id)).toEqual(['cal-laptop', 'cal-phone']);
});

test('a calendar removed on one side and refreshed on the other settles per calendar', () => {
  const base = preferences(); base.calendars = [calendar('work'), calendar('club')];
  const mine = preferences(); mine.calendars = [calendar('club')];
  const theirs = preferences(); theirs.calendars = [calendar('work', 'work', ['2027-01-12', '2027-01-19']), calendar('club', 'Club refreshed')];
  // This side removed work and left club alone; the other refreshed both. Both sides touched work, so this side wins it.
  expect(mergePreferences(base, mine, theirs).calendars).toEqual([calendar('club', 'Club refreshed')]);
});

test('removing the last calendar leaves the field absent, as a document without calendars has it', () => {
  const base = preferences(); base.calendars = [calendar('work')];
  const merged = mergePreferences(base, preferences(), base);
  expect('calendars' in merged).toBe(false);
});

test("a merge past the calendar limit keeps the latest and drops this side's newest rather than stopping sync", () => {
  const base = preferences(), mine = preferences(), theirs = preferences();
  theirs.calendars = Array.from({ length: 6 }, (_, i) => calendar(`latest-${i}`));
  mine.calendars = Array.from({ length: 4 }, (_, i) => calendar(`mine-${i}`));
  expect(mergePreferences(base, mine, theirs).calendars?.map((c) => c.id)).toEqual([...Array.from({ length: 6 }, (_, i) => `latest-${i}`), 'mine-0', 'mine-1']);
});

test('academic records merge disjoint courses, manual credit and transcript rows as course facts', () => {
  const base = academic(), mine = academic(), latest = academic();
  mine.courseStatuses['CSCE 1030'] = 'completed'; mine.manualCredit = ['CSCE 1030'];
  latest.courseStatuses['MATH 1710'] = 'inProgress';
  latest.transcriptRecords = [row('math', 'MATH 1710')];
  const merged = mergeAcademicRecord(base, mine, latest);
  expect(merged).toEqual({ body: { ...latest, courseStatuses: { 'CSCE 1030': 'completed', 'MATH 1710': 'inProgress' }, manualCredit: ['CSCE 1030'] }, questions: [] });
});

test('same academic decision on both sides needs no question, including record key ordering', () => {
  const base = academic(), mine = academic(), latest = academic();
  mine.courseStatuses = { A: 'completed', B: 'inProgress' };
  latest.courseStatuses = { B: 'inProgress', A: 'completed' };
  expect(mergeAcademicRecord(base, mine, latest)).toEqual({ body: mine, questions: [] });
});

test('removal of course facts is a three-way change and conflicting removal asks one question for the course', () => {
  const base = academic(); base.courseStatuses.A = 'completed'; base.manualCredit = ['A']; base.transcriptRecords = [row('a', 'A')];
  const mine = academic(), latest = academic(); latest.courseStatuses.A = 'inProgress'; latest.manualCredit = ['A']; latest.transcriptRecords = [row('a', 'A')];
  const merged = mergeAcademicRecord(base, mine, latest);
  expect(merged.body).toEqual(latest);
  expect(merged.questions).toEqual([{ kind: 'course', course: 'A', base: { status: 'completed', manualCredit: true, records: [row('a', 'A')] }, local: { status: null, manualCredit: false, records: [] }, latest: { status: 'inProgress', manualCredit: true, records: [row('a', 'A')] } }]);
  expect(mergeAcademicRecord(base, mine, base)).toEqual({ body: mine, questions: [] });
});

test('a changed transcript and a changed manual-credit decision on the same course are one question', () => {
  const base = academic(), mine = academic(), latest = academic();
  base.transcriptRecords = [row('a', 'A')]; mine.transcriptRecords = [row('a', 'A')]; latest.transcriptRecords = [{ ...row('a', 'A'), grade: 'B' }];
  mine.manualCredit = ['A'];
  const merged = mergeAcademicRecord(base, mine, latest);
  expect(merged.questions.map((question) => question.kind === 'course' ? question.course : question.kind)).toEqual(['A']);
  expect(merged.body).toEqual(latest);
});

test('conflicting major and catalog choices are questions while one-sided changes merge', () => {
  const base = academic(), mine = AcademicRecordBodySchema.parse({ ...academic(), major: 'cs', catalogId: 'unt-2026-27' }), latest = AcademicRecordBodySchema.parse({ ...academic(), major: 'math', catalogId: 'unt-2025-26' });
  const merged = mergeAcademicRecord(base, mine, latest);
  expect(merged.body.major).toBe('math'); expect(String(merged.body.catalogId)).toBe('unt-2025-26');
  expect(merged.questions.map((question) => question.kind)).toEqual(['major', 'catalogId']);
  expect(mergeAcademicRecord(base, mine, base)).toEqual({ body: mine, questions: [] });
});

test('a transcript row moved to another course cannot silently create two rows with one id', () => {
  const base = academic(), mine = academic(), latest = academic();
  base.transcriptRecords = [row('same', 'A')];
  mine.transcriptRecords = [row('same', 'B')];
  latest.transcriptRecords = [{ ...row('same', 'A'), grade: 'B' }];
  const merged = mergeAcademicRecord(base, mine, latest);
  expect(merged.questions.map((question) => question.kind)).toEqual(['course', 'transcript-id']);
});

test('each editable kind treats delete versus edit as conflict, and schedules never merge', () => {
  for (const [kind, body] of [['schedule', schedule()], ['preferences', preferences()], ['academic-record', academic()]] as const) {
    expect(resolveConflict(kind, body, body, null)).toEqual({ kind: 'delete-versus-edit' });
    expect(resolveConflict(kind, body, null, body)).toEqual({ kind: 'delete-versus-edit' });
  }
  expect(resolveConflict('schedule', schedule(), schedule(), schedule())).toEqual({ kind: 'schedule', choices: ['use-latest', 'keep-as-another-schedule', 'reapply-chosen-edits'] });
  expect(resolveConflict('preferences', null, preferences(), preferences())).toEqual({ kind: 'merged', body: preferences() });
});

function row(id: string, code: string) {
  return { id, code, title: code, term: 'Fall 2026', grade: 'A', credits: 3, sourceKind: 'unt', confidence: 1, rationale: '', duplicateExcluded: false, appliedStatus: 'completed', prerequisiteSatisfied: true, reviewRequired: false } as const;
}

test('concurrent first preference writes treat every local group as changed from absence', () => {
  const mine = preferences(), latest = preferences();
  mine.constraints.maxCredits = 12; latest.constraints.maxCredits = 20; latest.constraints.daysOff = ['Fri'];
  expect(resolveConflict('preferences', null, mine, latest)).toEqual({ kind: 'merged', body: mine });
});

test('concurrent first academic writes combine disjoint courses but ask about overlapping decisions', () => {
  const mine = academic(), latest = academic();
  mine.courseStatuses = { A: 'completed', B: 'inProgress' };
  latest.courseStatuses = { A: 'inProgress', C: 'completed' };
  const result = resolveConflict('academic-record', null, mine, latest);
  expect(result.kind).toBe('academic-record');
  if (result.kind !== 'academic-record') throw new Error('Expected a course question');
  expect(result.body.courseStatuses).toEqual({ A: 'inProgress', B: 'inProgress', C: 'completed' });
  expect(result.questions.map((question) => question.kind === 'course' ? question.course : question.kind)).toEqual(['A']);
});

test('a first write made on starting values merges preferences against them, so groups it never touched take the server copy', async () => {
  const { SyncEngine } = await import('../src/engine');
  const { MemoryStore } = await import('../src/store');
  const { io, preferences, remote } = await import('./fixtures');
  const start = preferences();
  const server = { ...start, constraints: { ...start.constraints, earliestStart: 540, latestEnd: 1020 } };
  const engine = new SyncEngine(new MemoryStore(), { kind: 'user', id: 'student-a' }, io({
    push: async () => ({ kind: 'conflict', latest: remote(server, 3, 'preferences') }),
  }));
  const mine = { ...start, constraints: { ...start.constraints, daysOff: ['Fri'] } };
  await engine.save({ documentId: 'doc', kind: 'preferences', body: mine, expectedGeneration: 0, startedFrom: start });
  await engine.syncNext('doc');
  const draft = (await engine.read()).documents[0].draft as typeof start;
  expect([draft.constraints.daysOff, draft.constraints.earliestStart, draft.constraints.latestEnd]).toEqual([['Fri'], 540, 1020]);
});
