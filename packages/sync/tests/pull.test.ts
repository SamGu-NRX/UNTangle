import { expect, test } from 'bun:test';
import { PullEntrySchema } from '@untangle/contracts/sync';
import { SyncEngine } from '../src/engine';
import { reconcilePull } from '../src/pull';
import { MemoryStore } from '../src/store';
import { syncStatus } from '../src/status';
import { io, remote, schedule, user } from './fixtures';

const entry = (revision = 1, deleted = false) => PullEntrySchema.parse({ documentId: 'doc', kind: 'schedule', revision, deleted });

test('pull fetches new documents, applies tombstones, and ignores missing or already-seen entries', async () => {
  const fetched: string[] = [];
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async (_id, id) => { fetched.push(id); return remote(); } }));
  expect(reconcilePull([], [entry()])).toEqual([{ kind: 'fetch', entry: entry() }]);
  await engine.pull([entry()]);
  const state = await engine.read();
  expect(state.documents[0].draft).toEqual(schedule());
  expect(syncStatus(user, state.documents[0])).toBe('Saved on this device');
  expect(reconcilePull(state.documents, [entry()])).toEqual([]);
  expect(reconcilePull(state.documents, [])).toEqual([]);
  expect(reconcilePull(state.documents, [entry(2, true)])).toEqual([{ kind: 'apply-delete', entry: entry(2, true) }]);
  await engine.pull([entry(2, true)]);
  expect((await engine.read()).documents[0].confirmed).toEqual({ revision: 2, body: null });
  expect(fetched).toEqual(['doc']);
});

test('a clean schedule adopts the latest while a dirty schedule keeps its draft and flags conflict', async () => {
  let latest = remote();
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => latest }));
  await engine.pull([entry()]); latest = remote(schedule('Second'), 2); await engine.pull([entry(2)]);
  expect((await engine.read()).documents[0].draft).toEqual(schedule('Second'));
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule('Local'), expectedGeneration: 2 });
  latest = remote(schedule('Third'), 3);
  expect(reconcilePull((await engine.read()).documents, [entry(3)])).toEqual([{ kind: 'conflict', entry: entry(3) }]);
  await engine.pull([entry(3)]);
  expect((await engine.read()).documents[0].draft).toEqual(schedule('Local'));
  expect((await engine.read()).documents[0].delivery).toEqual({ kind: 'conflict', latest: { revision: 3, body: schedule('Third') } });
});

test('a dirty schedule and a pull tombstone conflict without fetching or discarding the draft', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io());
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule(), expectedGeneration: 0 });
  await engine.pull([entry(2, true)]);
  expect(await engine.conflict('doc')).toEqual({ kind: 'delete-versus-edit' });
  expect((await engine.read()).documents[0].draft).toEqual(schedule());
});

test('an edit during a pull fetch is preserved instead of applying the clean-state decision from before the fetch', async () => {
  let began = () => {}, release = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => { began(); await gate; return remote(schedule('Server')); } }));
  const pulling = engine.pull([entry()]); await started;
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule('Local'), expectedGeneration: 0 });
  release(); await pulling;
  expect((await engine.read()).documents[0].draft).toEqual(schedule('Local'));
  expect(syncStatus(user, (await engine.read()).documents[0])).toBe('Resolve conflict');
});

test('discard while a pull is in flight cannot repopulate the signed-out identity', async () => {
  let began = () => {}, release = () => {};
  const started = new Promise<void>((resolve) => { began = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => { began(); await gate; return remote(); } }));
  const pulling = engine.pull([entry()]); await started;
  await engine.clearLocalData({ discardPending: true }); release(); await pulling;
  expect(await engine.read()).toEqual({ epoch: 1, documents: [], usedOperationIds: [] });
});

test('pull rejects duplicate ids, kind changes, wrong fetch targets and fetched revisions older than the list', async () => {
  expect(() => reconcilePull([], [entry(), entry()])).toThrow('listed twice');
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => remote() }));
  await engine.pull([entry()]);
  expect(() => reconcilePull(([]), [{ ...entry(), revision: 0 }])).toThrow();
  const documents = (await engine.read()).documents;
  expect(() => reconcilePull(documents, [{ ...entry(2), kind: 'preferences' }])).toThrow('changed the kind');
  await expect(engine.pull([entry(2)])).rejects.toThrow('predates');
  const wrong = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => ({ ...remote(), documentId: 'other' }) }));
  await expect(wrong.pull([entry()])).rejects.toThrow('does not match');
  expect((await engine.read()).documents[0].draft).toEqual(schedule());
});

test('an older pull cannot replace the newer server revision already shown in a conflict', async () => {
  let latest = remote(schedule('Newest server'), 5);
  const engine = new SyncEngine(new MemoryStore(), user, io({ fetch: async () => latest }));
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule('Local'), expectedGeneration: 0 });
  await engine.pull([entry(5)]);
  latest = remote(schedule('Stale server'), 3); await engine.pull([entry(3)]);
  expect((await engine.read()).documents[0].delivery).toEqual({ kind: 'conflict', latest: { revision: 5, body: schedule('Newest server') } });
  expect((await engine.read()).documents[0].draft).toEqual(schedule('Local'));
});
