export type CachedResponse = { body: ArrayBuffer; status: number; headers: [string, string][]; expiresAt: number };
export interface ResponseCache {
  get(key: string): Promise<CachedResponse | undefined>;
  put(key: string, value: CachedResponse): Promise<void>;
}

export class MemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, CachedResponse>();
  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 200) {}
  clear() { this.entries.clear(); }
  async get(key: string) {
    const value = this.entries.get(key);
    if (value && value.expiresAt > this.now()) return value;
    this.entries.delete(key);
  }
  async put(key: string, value: CachedResponse) {
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.entries.delete(entryKey);
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

export class IndexedDbResponseCache implements ResponseCache {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory, private readonly now: () => number = Date.now) {}
  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open("untangle-third-party-cache", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("responses").createIndex("expiry", "expiresAt");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Third-party cache upgrade is blocked by another tab."));
    });
    return this.database;
  }
  async get(key: string): Promise<CachedResponse | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("responses", "readonly");
      const request = transaction.objectStore("responses").get(key);
      // SAFETY: this versioned object store is written only by put with CachedResponse values.
      request.onsuccess = () => {
        const value = request.result as CachedResponse | undefined;
        resolve(value && value.expiresAt > this.now() ? value : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async put(key: string, value: CachedResponse): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("responses", "readwrite");
      const store = transaction.objectStore("responses");
      store.put(value, key);
      const expired = store.index("expiry").openCursor(IDBKeyRange.upperBound(this.now()));
      expired.onsuccess = () => {
        const cursor = expired.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
        else {
          const count = store.count();
          count.onsuccess = () => {
            let excess = count.result - 200;
            if (excess <= 0) return;
            const oldest = store.index("expiry").openCursor();
            oldest.onsuccess = () => {
              const cursor = oldest.result;
              if (cursor && excess-- > 0) { cursor.delete(); cursor.continue(); }
            };
          };
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
