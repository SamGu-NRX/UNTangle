import { DeviceGrantError, securityChangeTimeout, type DeviceStore, type DeviceToken, type DeviceTransaction, type Grant } from "@/server/auth/device-grants";

type State = {
  grants: Map<string, Grant>;
  tokens: Map<string, DeviceToken>;
  generations: Map<string, number>;
  changes: Map<string, { id: string; startedAt: number }>;
};

/** Serialized transactions with isolated reads and rollback on unexpected errors. */
export class MemoryDeviceStore implements DeviceStore {
  private state: State = { grants: new Map(), tokens: new Map(), generations: new Map(), changes: new Map() };
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly now: () => number = Date.now) {}

  private open(draft: State, userId: string) {
    const change = draft.changes.get(userId);
    return change !== undefined && change.startedAt > this.now() - securityChangeTimeout;
  }

  private async exclusive<T>(work: (draft: State) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = () => {};
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const draft = structuredClone(this.state);
      const result = await work(draft);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  transaction<T>(work: (tx: DeviceTransaction) => Promise<T>): Promise<T> {
    return this.exclusive(async (draft) => work({
      async grantBy(field, value) {
        const grant = [...draft.grants.values()].find((row) => row[field] === value);
        return grant ? structuredClone(grant) : null;
      },
      async saveGrant(grant) { draft.grants.set(grant.id, structuredClone(grant)); },
      async token(hash) { return structuredClone(draft.tokens.get(hash) ?? null); },
      async saveToken(token) { draft.tokens.set(token.hash, structuredClone(token)); },
      generation: async (userId) => { if (this.open(draft, userId)) throw new DeviceGrantError("invalid_token", 401); return draft.generations.get(userId) ?? 0; },
    }));
  }

  bumpGeneration(userId: string): Promise<void> {
    return this.exclusive(async (draft) => {
      draft.generations.set(userId, (draft.generations.get(userId) ?? 0) + 1);
    });
  }

  beginSecurityChange(userId: string, expectedGeneration?: number): Promise<string> {
    return this.exclusive(async draft => {
      const generation = draft.generations.get(userId) ?? 0;
      if (this.open(draft, userId) || (expectedGeneration !== undefined && expectedGeneration !== generation))
        throw new DeviceGrantError("account_changed", 409);
      const id = crypto.randomUUID();
      draft.generations.set(userId, generation + 1);
      draft.changes.set(userId, { id, startedAt: this.now() });
      return id;
    });
  }
  finishSecurityChange(userId: string, changeId: string): Promise<void> {
    return this.exclusive(async draft => {
      if (!draft.generations.has(userId)) throw new Error("No account security change to finish");
      draft.generations.set(userId, draft.generations.get(userId)! + 1);
      if (draft.changes.get(userId)?.id === changeId) draft.changes.delete(userId);
    });
  }

  snapshot() {
    return structuredClone({
      grants: [...this.state.grants.values()],
      tokens: [...this.state.tokens.values()],
      generations: Object.fromEntries(this.state.generations),
    });
  }
}
