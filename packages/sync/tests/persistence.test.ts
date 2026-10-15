import { expect, test } from 'bun:test';
import { SyncEngine } from '../src/engine';
import { parseStoreState } from '../src/persistence';
import { MemoryStore } from '../src/store';
import { io, remote, schedule, user } from './fixtures';

async function stored() {
  const engine = new SyncEngine(new MemoryStore(), user, io());
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule(), expectedGeneration: 0 });
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule('Later'), expectedGeneration: 1 });
  return { engine, value: { format: 1, state: await engine.read() } };
}

test('persisted outbox survives serialization with its exact bytes, base bodies and queued revisions', async () => {
  const { engine, value } = await stored();
  const recovered = parseStoreState(JSON.parse(JSON.stringify(value)), user);
  expect(recovered.documents[0].pending.map((pending) => [pending.write.baseRevision, pending.baseBody])).toEqual([[0, null], [1, schedule()]]);
  expect(recovered.documents[0].pending.map((pending) => pending.bytes)).toEqual(value.state.documents[0].pending.map((pending) => pending.bytes));
  await engine.syncNext('doc');
  expect(parseStoreState({ format: 1, state: await engine.read() }, user).documents[0].confirmed).toEqual({ revision: 1, body: schedule() });
  await engine.syncNext('doc');
  expect(parseStoreState({ format: 1, state: await engine.read() }, user).documents[0].confirmed).toEqual({ revision: 2, body: schedule('Later') });
});

test('serialized write mismatch, broken queue and unsupported storage fail without erasing the supplied state', async () => {
  const { value } = await stored();
  value.state.documents[0].pending[0].bytes = '{}';
  expect(() => parseStoreState(value, user)).toThrow();
  expect(value.state.documents[0].draft).toEqual(schedule('Later'));
  const second = (await stored()).value;
  second.state.documents[0].pending[1].baseBody = null;
  expect(() => parseStoreState(second, user)).toThrow('revision chain');
  expect(() => parseStoreState({ ...second, format: 2 }, user)).toThrow('Unsupported');
  expect(parseStoreState(undefined, user)).toEqual({ epoch: 0, documents: [], usedOperationIds: [] });
});

test('stored receipts cannot cross identities and user outboxes cannot load as guest state', async () => {
  const { engine, value } = await stored();
  expect(() => parseStoreState(value, { kind: 'guest', id: user.id })).toThrow('guest');
  await engine.syncNext('doc');
  const synced = { format: 1, state: await engine.read() };
  expect(() => parseStoreState(synced, { kind: 'user', id: 'another' })).toThrow('another identity');
  expect(parseStoreState(synced, user).documents[0].receipt?.userId).toBe('student-a');
});

test('a conflict can be reopened from storage without losing its original base or server choice', async () => {
  const engine = new SyncEngine(new MemoryStore(), user, io({ push: async () => ({ kind: 'conflict', latest: remote(schedule('Server'), 4) }) }));
  await engine.save({ documentId: 'doc', kind: 'schedule', body: schedule('Local'), expectedGeneration: 0 });
  await engine.syncNext('doc');
  const recovered = parseStoreState({ format: 1, state: await engine.read() }, user);
  expect(recovered.documents[0].delivery).toEqual({ kind: 'conflict', latest: { revision: 4, body: schedule('Server') } });
  expect(recovered.documents[0].pending[0].baseBody).toBeNull();
  expect(recovered.documents[0].draft).toEqual(schedule('Local'));
});
