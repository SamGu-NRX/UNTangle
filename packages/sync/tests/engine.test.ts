import { expect, test } from 'bun:test';
import { VersionBodySchema } from '@untangle/contracts/documents';
import { SyncEngine } from '../src/engine';
import { MemoryStore } from '../src/store';
import { syncStatus } from '../src/status';
import { academic, hash, io, preferences, remote, schedule, user } from './fixtures';

const save = (engine: SyncEngine, generation = 0, name = 'Main') => engine.save({ documentId: 'doc', kind: 'schedule', body: schedule(name), expectedGeneration: generation });
const doc = async (engine: SyncEngine) => (await engine.read()).documents[0];
const list = (revision: number, deleted = false, kind = 'schedule') => [{ documentId: 'doc', kind, revision, deleted }];

 test('a committed write with a dropped response retries identical bytes after restart and only a receipt means synced', async () => {
  const store = new MemoryStore();
  const requests: string[] = [];
  const receipts = new Map<string, unknown>();
  const adapter = io({ push: async (userId, bytes) => {
    requests.push(bytes);
    const write = JSON.parse(bytes);
    if (receipts.has(write.operationId)) return { kind: 'receipt', receipt: receipts.get(write.operationId) };
    receipts.set(write.operationId, { userId, operationId: write.operationId, writeSha256: await hash(bytes), committedRevision: 1 });
    throw new Error('Response dropped after commit');
  } });
  const before = new SyncEngine(store, user, adapter);
  const stored = await save(before);
  expect(stored.pending[0].write.body).toEqual(schedule());
  expect(syncStatus(user, stored)).toBe('Waiting to sync');
  await before.syncNext('doc');
  expect(syncStatus(user, await doc(before))).toBe('Save not confirmed (retrying)');
  const after = new SyncEngine(store, user, adapter);
  await after.pull(list(1));
  expect(requests).toEqual([stored.pending[0].bytes, stored.pending[0].bytes]);
  expect(receipts.size).toBe(1);
  expect((await doc(after)).confirmed).toEqual({ revision: 1, body: schedule() });
  expect(syncStatus(user, await doc(after))).toBe('Synced');
});

test('queued edits use consecutive revisions and concurrent engines serialize one document', async () => {
  const store = new MemoryStore();
  let release = () => {};
  let began = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const writes: { baseRevision: number; body: { name: string } }[] = [];
  let active = 0, maximum = 0;
  const defaultIO = io();
  const adapter = io({ push: async (id, bytes) => {
    active++; maximum = Math.max(maximum, active);
    writes.push(JSON.parse(bytes)); began();
    await gate;
    active--;
    return defaultIO.push(id, bytes);
  } });
  const first = new SyncEngine(store, user, adapter), second = new SyncEngine(store, user, adapter);
  await save(first);
  const sending = first.syncNext('doc');
  await started;
  await save(first, 1, 'Edited while sending');
  const following = second.syncNext('doc');
  release(); await Promise.all([sending, following]);
  expect(maximum).toBe(1);
  expect(writes.map((write) => [write.baseRevision, write.body.name])).toEqual([[0, 'Main'], [1, 'Edited while sending']]);
  expect((await doc(first)).confirmed).toEqual({ revision: 2, body: schedule('Edited while sending') });
  expect(syncStatus(user, await doc(first))).toBe('Synced');
});

test('an earlier receipt leaves a later draft waiting, and stale local editor tokens are rejected', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io());
  await save(engine); await save(engine, 1, 'Next');
  await engine.syncNext('doc');
  expect(syncStatus(user, await doc(engine))).toBe('Waiting to sync');
  expect((await doc(engine)).draft).toEqual(schedule('Next'));
  await expect(save(engine, 1, 'Stale')).rejects.toThrow('Local document changed');
  expect((await doc(engine)).pending[0].write.baseRevision).toBe(1);
});

test('sign-in failures preserve the outbox and resume the same operation', async () => {
  let authorized = false;
  const normal = io();
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: (id, bytes) => authorized ? normal.push(id, bytes) : Promise.resolve({ kind: 'needs-sign-in' }) }));
  await save(engine); await engine.syncNext('doc');
  expect(syncStatus(user, await doc(engine))).toBe('Needs sign-in');
  expect(await engine.hasUnsyncedChanges()).toBe(true);
  await expect(engine.clearLocalData({ discardPending: false })).rejects.toThrow('explicit discard');
  authorized = true; await engine.syncNext('doc');
  expect(syncStatus(user, await doc(engine))).toBe('Synced');
});

test.each(['user', 'operation', 'hash', 'revision'])('a receipt with the wrong %s cannot acknowledge a write', async (wrong) => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async (userId, bytes) => {
    const write = JSON.parse(bytes);
    return { kind: 'receipt', receipt: { userId: wrong === 'user' ? 'other' : userId, operationId: wrong === 'operation' ? 'other' : write.operationId, writeSha256: wrong === 'hash' ? '0'.repeat(64) : await hash(bytes), committedRevision: wrong === 'revision' ? 4 : 1 } };
  } }));
  await save(engine);
  await expect(engine.syncNext('doc')).rejects.toThrow('does not confirm');
  expect(syncStatus(user, await doc(engine))).toBe('Save not confirmed (retrying)');
  expect((await doc(engine)).pending).toHaveLength(1);
});

test('schedule conflict keeps the latest draft and returns all three choices without sending it again', async () => {
  let requests = 0;
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async () => { requests++; return { kind: 'conflict', latest: remote(schedule('Other device'), 2) }; } }));
  await save(engine); await save(engine, 1, 'Newest local'); await engine.syncNext('doc');
  expect(syncStatus(user, await doc(engine))).toBe('Resolve conflict');
  expect((await doc(engine)).draft).toEqual(schedule('Newest local'));
  expect(await engine.conflict('doc')).toEqual({ kind: 'schedule', choices: ['use-latest', 'keep-as-another-schedule', 'reapply-chosen-edits'] });
  await engine.syncNext('doc'); expect(requests).toBe(1);
  await engine.resolve('doc', (await doc(engine)).generation, { kind: 'use-latest' });
  expect((await doc(engine)).draft).toEqual(schedule('Other device'));
  expect(syncStatus(user, await doc(engine))).toBe('Saved on this device');
});

test('a stale offline academic decision becomes a question, never an automatic write over the newer decision', async () => {
  const base = academic(); base.courseStatuses['CSCE 1030'] = 'notTaken';
  const latest = academic(); latest.courseStatuses['CSCE 1030'] = 'inProgress';
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => remote(base, 1, 'academic-record'), push: async () => ({ kind: 'conflict', latest: remote(latest, 2, 'academic-record') }) }));
  await engine.pull(list(1, false, 'academic-record'));
  const local = academic(); local.courseStatuses['CSCE 1030'] = 'completed';
  await engine.save({ documentId: 'doc', kind: 'academic-record', body: local, expectedGeneration: 1 });
  await engine.syncNext('doc');
  const conflict = await engine.conflict('doc');
  expect(conflict?.kind).toBe('academic-record');
  if (conflict?.kind !== 'academic-record') throw new Error('Expected academic conflict');
  expect(conflict.body.courseStatuses).toEqual({ 'CSCE 1030': 'inProgress' });
  expect(conflict.questions.map((question) => question.kind)).toEqual(['course']);
  expect(syncStatus(user, await doc(engine))).toBe('Resolve conflict');
});

test('preferences automatically rebase against their saved base, using a new operation id', async () => {
  const base = preferences(), latest = preferences(), mine = preferences();
  mine.constraints.maxCredits = 12; latest.constraints.daysOff = ['Fri'];
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => remote(base, 3, 'preferences'), push: async () => ({ kind: 'conflict', latest: remote(latest, 4, 'preferences') }) }));
  await engine.pull(list(3, false, 'preferences'));
  await engine.save({ documentId: 'doc', kind: 'preferences', body: mine, expectedGeneration: 1 });
  await engine.syncNext('doc');
  expect((await doc(engine)).pending[0].write).toMatchObject({ operationId: 'operation-2', baseRevision: 4, body: { constraints: { maxCredits: 12, daysOff: ['Fri'] } } });
  expect(syncStatus(user, await doc(engine))).toBe('Waiting to sync');
});

test('delete versus edit is a conflict and an offline draft cannot resurrect a deleted document', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async () => ({ kind: 'conflict', latest: remote(null, 2) }) }));
  await save(engine); await engine.syncNext('doc');
  expect(await engine.conflict('doc')).toEqual({ kind: 'delete-versus-edit' });
  await expect(engine.resolve('doc', (await doc(engine)).generation, { kind: 'write', body: schedule() })).rejects.toThrow('cannot be resurrected');
  expect((await doc(engine)).draft).toEqual(schedule());
  await engine.resolve('doc', (await doc(engine)).generation, { kind: 'use-latest' });
  expect((await doc(engine)).confirmed).toEqual({ revision: 2, body: null });
  await expect(save(engine, (await doc(engine)).generation)).rejects.toThrow('cannot be resurrected');
});

test('a local delete conflicts with a server edit', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => remote(), push: async () => ({ kind: 'conflict', latest: remote(schedule('Edited'), 2) }) }));
  await engine.pull(list(1));
  await engine.save({ documentId: 'doc', kind: 'schedule', body: null, expectedGeneration: 1 });
  await engine.syncNext('doc');
  expect(await engine.conflict('doc')).toEqual({ kind: 'delete-versus-edit' });
  expect((await doc(engine)).draft).toBeNull();
  expect((await doc(engine)).delivery).toEqual({ kind: 'conflict', latest: { revision: 2, body: schedule('Edited') } });
});

test('identities isolate drafts, receipts and outboxes, including guest and user with the same id', async () => {
  const store = new MemoryStore();
  const a = new SyncEngine(store, user, io());
  const b = new SyncEngine(store, { kind: 'user', id: 'student-b' }, io());
  const guest = new SyncEngine(store, { kind: 'guest', id: user.id }, io({ push: async () => { throw new Error('Guest must not push'); } }));
  await save(a, 0, 'Private transcript plan'); await save(guest, 0, 'Guest plan');
  await guest.syncNext('doc');
  expect((await b.read()).documents).toEqual([]);
  expect((await doc(a)).draft).toEqual(schedule('Private transcript plan'));
  expect((await doc(guest)).draft).toEqual(schedule('Guest plan'));
  expect(syncStatus(guest.identity, await doc(guest))).toBe('Saved on this device');
  expect((await doc(guest)).pending).toEqual([]);
  await a.clearLocalData({ discardPending: true });
  expect((await a.read()).documents).toEqual([]);
  expect((await doc(guest)).draft).toEqual(schedule('Guest plan'));
});

test('a late receipt after explicit sign-out discard cannot recreate account data', async () => {
  let release = () => {};
  let began = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const normal = io();
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async (id, bytes) => { began(); await gate; return normal.push(id, bytes); } }));
  await save(engine); const sending = engine.syncNext('doc'); await started;
  await engine.clearLocalData({ discardPending: true }); release(); await sending;
  expect(await engine.read()).toEqual({ epoch: 1, documents: [], usedOperationIds: [] });
});

test('store transactions roll back both document and outbox on failure and reads cannot mutate storage', async () => {
  const store = new MemoryStore(); const engine = new SyncEngine(store, user, io());
  await save(engine);
  await expect(store.transact(user, (state) => { state.documents[0].pending = []; state.documents[0].draft = null; throw new Error('Storage failed'); })).rejects.toThrow('Storage failed');
  const snapshot = await engine.read(); snapshot.documents[0].pending = [];
  expect((await doc(engine)).pending[0].write.body).toEqual(schedule());
  expect((await doc(engine)).draft).toEqual(schedule());
});

test('duplicate operation ids fail atomically without replacing the draft', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ operationId: () => 'same' }));
  await save(engine);
  await expect(save(engine, 1, 'Lost')).rejects.toThrow('already used');
  expect((await doc(engine)).draft).toEqual(schedule());
  expect((await doc(engine)).pending).toHaveLength(1);
});

test('versions are append-only for guests as well as users', async () => {
  for (const identity of [user, { kind: 'guest', id: 'guest' } as const]) {
    const engine = new SyncEngine(new MemoryStore(), identity, io());
    const body = VersionBodySchema.parse({ institutionId: 'unt', scheduleId: 'schedule', reason: 'before-auto', schedule: schedule() });
    await engine.save({ documentId: 'version', kind: 'version', body, expectedGeneration: 0 });
    await expect(engine.save({ documentId: 'version', kind: 'version', body: null, expectedGeneration: 1 })).rejects.toThrow('created once');
    expect((await doc(engine)).draft).toEqual(body);
  }
});

test('an edit cannot queue behind an unconfirmed delete and resurrect the same document id', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => remote() }));
  await engine.pull(list(1));
  await engine.save({ documentId: 'doc', kind: 'schedule', body: null, expectedGeneration: 1 });
  await expect(save(engine, 2, 'Resurrection')).rejects.toThrow('cannot be resurrected');
  expect((await doc(engine)).pending.map((pending) => pending.write.body)).toEqual([null]);
  await engine.syncNext('doc');
  expect((await doc(engine)).confirmed).toEqual({ revision: 2, body: null });
});

test('a save hashing across sign-out cannot recreate the discarded draft', async () => {
  let began = () => {}, release = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const engine = new SyncEngine(new MemoryStore(), user, io({ sha256: async (bytes) => { began(); await gate; return hash(bytes); } }));
  const saving = save(engine); await started;
  await engine.clearLocalData({ discardPending: true }); release();
  await expect(saving).rejects.toThrow('discarded while saving');
  expect(await engine.read()).toEqual({ epoch: 1, documents: [], usedOperationIds: [] });
});

test('explicitly reapplied schedule edits become a new operation against the viewed latest revision', async () => {
  let conflicted = false;
  const normal = io();
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async (id, bytes) => {
    if (!conflicted) { conflicted = true; return { kind: 'conflict', latest: remote(schedule('Server'), 8) }; }
    return normal.push(id, bytes);
  } }));
  await save(engine); await engine.syncNext('doc');
  const generation = (await doc(engine)).generation;
  await expect(engine.resolve('doc', generation - 1, { kind: 'write', body: schedule('Wrong view') })).rejects.toThrow('Local document changed');
  await engine.resolve('doc', generation, { kind: 'write', body: schedule('Reapplied') });
  expect((await doc(engine)).pending[0].write).toMatchObject({ operationId: 'operation-2', baseRevision: 8, body: { name: 'Reapplied' } });
  await engine.syncNext('doc');
  expect((await doc(engine)).confirmed).toEqual({ revision: 9, body: schedule('Reapplied') });
});

test('a store callback that accidentally returns a promise cannot commit partial state', async () => {
  const store = new MemoryStore(); const engine = new SyncEngine(store, user, io());
  await save(engine);
  await expect(store.transact(user, async (state) => { state.documents = []; })).rejects.toThrow('must be synchronous');
  expect((await doc(engine)).draft).toEqual(schedule());
});

test('a restart between recording a preference conflict and preparing its merge resumes automatically', async () => {
  const store = new MemoryStore(); const base = preferences(), latest = preferences(), mine = preferences();
  latest.constraints.daysOff = ['Fri']; mine.constraints.maxCredits = 12;
  let available = true, firstPush = true;
  const normal = io();
  const adapter = io({
    fetch: async () => remote(base, 1, 'preferences'),
    push: async (id, bytes) => {
      if (firstPush) { firstPush = false; available = false; return { kind: 'conflict', latest: remote(latest, 2, 'preferences') }; }
      return normal.push(id, bytes);
    },
    sha256: async (bytes) => { if (!available) throw new Error('Process interrupted before rebase'); return hash(bytes); },
  });
  const before = new SyncEngine(store, user, adapter);
  await before.pull(list(1, false, 'preferences'));
  await before.save({ documentId: 'doc', kind: 'preferences', body: mine, expectedGeneration: 1 });
  await expect(before.syncNext('doc')).rejects.toThrow('Process interrupted');
  expect((await doc(before)).delivery.kind).toBe('conflict');
  available = true;
  const after = new SyncEngine(store, user, adapter);
  await after.syncNext('doc'); await after.syncNext('doc');
  expect((await doc(after)).confirmed).toEqual({ revision: 3, body: { ...mine, constraints: { ...mine.constraints, daysOff: ['Fri'] } } });
  expect(syncStatus(user, await doc(after))).toBe('Synced');
});

test('an edit during delete delivery is rejected without changing the pending delete bytes', async () => {
  let began = () => {}, release = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests: string[] = [];
  const normal = io();
  const engine = new SyncEngine(new MemoryStore(), user, io({
    fetch: async () => remote(),
    push: async (id, bytes) => {
      requests.push(bytes);
      began();
      await gate;
      return normal.push(id, bytes);
    },
  }));
  await engine.pull(list(1));
  const deleted = await engine.save({ documentId: 'doc', kind: 'schedule', body: null, expectedGeneration: 1 });
  const sending = engine.syncNext('doc');
  await started;
  try {
    await expect(save(engine, deleted.generation, 'Resurrection while sending')).rejects.toThrow('cannot be resurrected');
    const pending = await doc(engine);
    expect(pending.draft).toBeNull();
    expect(pending.pending.map((item) => item.bytes)).toEqual([deleted.pending[0].bytes]);
    expect(syncStatus(user, pending)).toBe('Save not confirmed (retrying)');
  } finally {
    release();
    await sending;
  }
  await engine.syncNext('doc');
  expect(requests).toEqual([deleted.pending[0].bytes]);
  expect((await doc(engine)).confirmed).toEqual({ revision: 2, body: null });
  expect(syncStatus(user, await doc(engine))).toBe('Synced');
});
