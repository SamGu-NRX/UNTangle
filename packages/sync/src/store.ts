import type { Document, DocumentKind } from '@untangle/contracts/documents';
import type { Receipt, Write } from '@untangle/contracts/sync';

export type Identity = { kind: 'user'; id: string } | { kind: 'guest'; id: string };
export function identityKey(identity: Identity): string {
  if (!identity.id.trim()) throw new Error('An identity needs a nonempty id.');
  return JSON.stringify([identity.kind, identity.id]);
}

export type Body = Document['body'];
export type Snapshot = { revision: number; body: Body | null };
export type PendingWrite = {
  write: Write;
  /** Persisted once. Transport must send this UTF-8 string without reserialization. */
  bytes: string;
  sha256: string;
  baseBody: Body | null;
};
export type Delivery =
  | { kind: 'waiting' }
  | { kind: 'retrying' }
  | { kind: 'needs-sign-in' }
  | { kind: 'conflict'; latest: Snapshot };
export type LocalDocument = {
  documentId: Write['documentId'];
  kind: DocumentKind;
  /** Local compare-and-set token. Editors must present the token they read. */
  generation: number;
  confirmed: Snapshot;
  draft: Body | null;
  pending: PendingWrite[];
  delivery: Delivery;
  receipt: Receipt | null;
};
export type StoreState = {
  /** Retained on discard, so work started before sign-out cannot recreate private data. */
  epoch: number;
  documents: LocalDocument[];
  usedOperationIds: string[];
};
export const emptyState = (): StoreState => ({ epoch: 0, documents: [], usedOperationIds: [] });

export interface LocalStore {
  read(identity: Identity): Promise<StoreState>;
  /** A synchronous callback in one durable transaction. Throwing rolls back all changes. */
  transact<T>(identity: Identity, change: (state: StoreState) => T): Promise<T>;
  /** Exclusive across every engine/tab sharing this store, including network waits. */
  exclusive<T>(identity: Identity, documentId: string, work: () => Promise<T>): Promise<T>;
}

/** Store values contain only contract JSON, arrays and records. */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export class MemoryStore implements LocalStore {
  private readonly states = new Map<string, StoreState>();
  private readonly locks = new Map<string, Promise<void>>();

  async read(identity: Identity): Promise<StoreState> {
    return copy(this.states.get(identityKey(identity)) ?? emptyState());
  }

  async transact<T>(identity: Identity, change: (state: StoreState) => T): Promise<T> {
    const key = identityKey(identity);
    const state = copy(this.states.get(key) ?? emptyState());
    const result = change(state);
    if (result instanceof Promise) throw new Error('A sync storage transaction callback must be synchronous.');
    this.states.set(key, copy(state));
    return result === undefined ? result : copy(result);
  }

  async exclusive<T>(identity: Identity, documentId: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([identityKey(identity), documentId]);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
