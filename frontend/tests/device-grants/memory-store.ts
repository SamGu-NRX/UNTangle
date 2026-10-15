import { DeviceGrantError, type DeviceStore, type DeviceToken, type DeviceTransaction, type Grant } from "@/server/auth/device-grants";

type State = {
  grants: Map<string, Grant>;
  tokens: Map<string, DeviceToken>;
  generations: Map<string, number>;
  transitions: Map<string, number>;
};

/** Serialized transactions with isolated reads and rollback on unexpected errors. */
export class MemoryDeviceStore implements DeviceStore {
  private state: State = { grants: new Map(), tokens: new Map(), generations: new Map(), transitions: new Map() };
  private queue: Promise<void> = Promise.resolve();

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
      async generation(userId) { if ((draft.transitions.get(userId) ?? 0) > 0) throw new DeviceGrantError("invalid_token", 401); return draft.generations.get(userId) ?? 0; },
    }));
  }

  bumpGeneration(userId: string): Promise<void> {
    return this.exclusive(async (draft) => {
      draft.generations.set(userId, (draft.generations.get(userId) ?? 0) + 1);
    });
  }

  beginSecurityChange(userId: string): Promise<void> {
    return this.exclusive(async draft => {
      draft.generations.set(userId, (draft.generations.get(userId) ?? 0) + 1);
      draft.transitions.set(userId, (draft.transitions.get(userId) ?? 0) + 1);
    });
  }
  finishSecurityChange(userId: string): Promise<void> {
    return this.exclusive(async draft => {
      const count = draft.transitions.get(userId) ?? 0;
      if (!count) throw new Error("No active account security change to finish");
      draft.transitions.set(userId, count - 1);
      draft.generations.set(userId, (draft.generations.get(userId) ?? 0) + 1);
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
