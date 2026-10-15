import { changeNotCurrent, credentialExists, DeviceGrantError, securityChangeInProgress, securityChangeTimeout, staleSession, type DeviceStore, type DeviceToken, type DeviceTransaction, type Grant, type SecurityChange } from "@/server/auth/device-grants";

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
  /** better-auth's memory tables, for the writes that touch accounts and sessions (useAuthTables). */
  private auth: { account: Record<string, unknown>[]; session: Record<string, unknown>[] } | null = null;
  constructor(private readonly now: () => number = Date.now) {}

  /** Points the account and session writes at a better-auth memory adapter's tables. */
  useAuthTables(tables: Record<string, unknown[]>) {
    this.auth = tables as { account: Record<string, unknown>[]; session: Record<string, unknown>[] };
  }
  private tables() {
    if (!this.auth) throw new Error("MemoryDeviceStore needs useAuthTables before it can write accounts or sessions.");
    return this.auth;
  }

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

  readGeneration(userId: string) {
    return this.exclusive(async draft => ({ generation: draft.generations.get(userId) ?? 0, changing: this.open(draft, userId) }));
  }
  beginSecurityChange(userId: string, expectedGeneration?: number): Promise<SecurityChange> {
    return this.exclusive(async draft => {
      const generation = draft.generations.get(userId) ?? 0;
      if (this.open(draft, userId)) throw securityChangeInProgress();
      if (expectedGeneration !== undefined && expectedGeneration !== generation) throw staleSession();
      const changeId = crypto.randomUUID();
      draft.generations.set(userId, generation + 1);
      draft.changes.set(userId, { id: changeId, startedAt: this.now() });
      return { changeId, generation: generation + 1 };
    });
  }
  writeCredential(userId: string, changeId: string, passwordHash: string, mode: "update" | "insert"): Promise<void> {
    return this.exclusive(async draft => {
      if (draft.changes.get(userId)?.id !== changeId) throw staleSession();
      const { account } = this.tables();
      const credentials = account.filter(row => row.userId === userId && row.providerId === "credential");
      if (mode === "update") {
        if (credentials.length === 0) throw new Error("No credential to update.");
        for (const row of credentials) Object.assign(row, { password: passwordHash, updatedAt: new Date(this.now()) });
      } else {
        if (credentials.length > 0) throw credentialExists();
        account.push({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: new Date(this.now()), updatedAt: new Date(this.now()) });
      }
    });
  }
  endStaleSession(token: string): Promise<boolean> {
    return this.exclusive(async draft => {
      const { session } = this.tables();
      const index = session.findIndex(row => row.token === token);
      if (index < 0) return false;
      const userId = session[index].userId as string;
      if (this.open(draft, userId) || session[index].securityGeneration === (draft.generations.get(userId) ?? 0)) return false;
      session.splice(index, 1);
      return true;
    });
  }
  finishSecurityChange(userId: string, changeId: string, keepSession?: string): Promise<number> {
    return this.exclusive(async draft => {
      if (draft.changes.get(userId)?.id !== changeId) throw changeNotCurrent();
      const generation = draft.generations.get(userId)! + 1;
      if (keepSession !== undefined) {
        const session = this.tables().session.find(row => row.token === keepSession && row.userId === userId);
        if (session) session.securityGeneration = generation;
      }
      draft.generations.set(userId, generation);
      draft.changes.delete(userId);
      return generation;
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
