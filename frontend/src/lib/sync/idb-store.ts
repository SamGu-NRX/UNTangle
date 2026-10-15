import { copy, emptyState, identityKey, parseStoreState, type Identity, type LocalStore, type StoreState } from '@untangle/sync';

/** The caller supplies browser APIs. Locks serialize sends across tabs without holding an IDB transaction over network I/O. */
export async function openIndexedDbStore(options: {
  indexedDB: IDBFactory;
  locks: Pick<LockManager, 'request'>;
  databaseName?: string;
}): Promise<IndexedDbStore> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = options.indexedDB.open(options.databaseName ?? 'untangle-sync-v1', 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore('identities'); };
    request.onerror = () => reject(request.error ?? new Error('Cannot open sync storage.'));
    request.onblocked = () => { blocked = true; reject(new Error('Sync storage upgrade is blocked by another tab.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  return new IndexedDbStore(database, options.locks);
}

export class IndexedDbStore implements LocalStore {
  constructor(private readonly database: IDBDatabase, private readonly locks: Pick<LockManager, 'request'>) {}

  read(identity: Identity): Promise<StoreState> {
    return this.run(identity, 'readonly', (state) => state);
  }

  transact<T>(identity: Identity, change: (state: StoreState) => T): Promise<T> {
    return this.run(identity, 'readwrite', change);
  }

  async exclusive<T>(identity: Identity, documentId: string, work: () => Promise<T>): Promise<T> {
    return await this.locks.request(JSON.stringify(['untangle-sync', this.database.name, identityKey(identity), documentId]), work);
  }

  close(): void { this.database.close(); }

  private run<T>(identity: Identity, mode: IDBTransactionMode, change: (state: StoreState) => T): Promise<T> {
    const key = identityKey(identity);
    return new Promise<T>((resolve, reject) => {
      // The document and pending write share one record and commit together.
      const transaction = this.database.transaction('identities', mode, { durability: 'strict' });
      const store = transaction.objectStore('identities');
      const request = store.get(key);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Sync storage transaction aborted.'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Sync storage transaction failed.'));
      request.onsuccess = () => {
        try {
          const state = request.result === undefined ? emptyState() : parseStoreState(request.result, identity);
          const changed = change(state);
          if (changed instanceof Promise) throw new Error('A sync storage transaction callback must be synchronous.');
          result = changed === undefined ? changed : copy(changed);
          if (mode === 'readwrite') store.put({ format: 1, state }, key);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
    });
  }
}
