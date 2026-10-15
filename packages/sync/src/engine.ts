import { DocumentSchema, documentBodySchemas, type DocumentKind } from '@untangle/contracts/documents';
import { DocumentIdSchema } from '@untangle/contracts/ids';
import { ReceiptSchema, WriteSchema } from '@untangle/contracts/sync';
import { resolveConflict, type ConflictResolution } from './conflicts';
import { reconcilePull } from './pull';
import { copy, identityKey, type Body, type Identity, type LocalDocument, type LocalStore, type PendingWrite, type Snapshot, type StoreState } from './store';

export type RemoteDocument = {
  documentId: string;
  kind: DocumentKind;
  revision: number;
  schemaVersion: 1;
  body: unknown;
};
export type PushResult =
  | { kind: 'receipt'; receipt: unknown }
  | { kind: 'needs-sign-in' }
  | { kind: 'conflict'; latest: RemoteDocument };
export interface SyncIO {
  /** Must send the string verbatim. A thrown error means the commit is uncertain. */
  push(userId: string, bytes: string): Promise<PushResult>;
  fetch(userId: string, documentId: string): Promise<RemoteDocument>;
  sha256(bytes: string): Promise<string>;
  operationId(): string;
}

function parseBody(kind: DocumentKind, body: unknown): Body | null {
  return body === null ? null : documentBodySchemas[kind].parse(body);
}
function remoteSnapshot(remote: RemoteDocument, documentId: string, kind: DocumentKind): Snapshot {
  if (remote.documentId !== documentId || remote.kind !== kind) throw new Error('Remote document identity or kind does not match.');
  if (remote.schemaVersion !== 1 || !Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new Error('Unsupported remote schema or revision.');
  if (remote.body === null) {
    if (kind === 'version') throw new Error('A version cannot be deleted.');
    return { revision: remote.revision, body: null };
  }
  const parsed = DocumentSchema.parse(remote);
  return { revision: parsed.revision, body: parsed.body };
}
function requireGeneration(document: LocalDocument | undefined, generation: number) {
  if ((document?.generation ?? 0) !== generation) throw new Error('Local document changed. Read the latest draft before saving.');
}
function addOperation(state: StoreState, pending: PendingWrite) {
  if (state.usedOperationIds.includes(pending.write.operationId)) throw new Error('Operation id was already used for this identity.');
  state.usedOperationIds.push(pending.write.operationId);
}

/** One engine has one immutable identity. Signing in creates a different engine, never retags data. */
export class SyncEngine {
  readonly identity: Identity;
  constructor(private readonly store: LocalStore, identity: Identity, private readonly io: SyncIO) {
    identityKey(identity);
    this.identity = Object.freeze(copy(identity));
  }

  async read(): Promise<StoreState> { return this.store.read(this.identity); }

  private async prepare(documentId: string, kind: DocumentKind, base: Snapshot, body: Body | null): Promise<PendingWrite> {
    const write = WriteSchema.parse({ operationId: this.io.operationId(), documentId, kind, baseRevision: base.revision, schemaVersion: 1, body });
    const bytes = JSON.stringify(write);
    const sha256 = await this.io.sha256(bytes);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('SHA-256 adapter must return 64 lowercase hex digits.');
    return { write, bytes, sha256, baseBody: copy(base.body) };
  }

  async save(input: { documentId: string; kind: DocumentKind; body: unknown; expectedGeneration: number }): Promise<LocalDocument> {
    const documentId = DocumentIdSchema.parse(input.documentId);
    const body = parseBody(input.kind, input.body);
    const state = await this.read();
    const current = state.documents.find((document) => document.documentId === documentId);
    requireGeneration(current, input.expectedGeneration);
    if (current && current.kind !== input.kind) throw new Error('A document cannot change kind.');
    // A queued delete commits first; accepting a later edit would resurrect the same id.
    const deleted = current && (current.confirmed.revision > 0 && current.confirmed.body === null || current.pending.at(-1)?.write.body === null);
    if (deleted && body !== null) throw new Error('A deleted document cannot be resurrected. Save a new document id.');
    if (current?.delivery.kind === 'conflict') throw new Error('Resolve the conflict before editing this document.');
    if (input.kind === 'version' && (current || body === null)) throw new Error('A version is created once and cannot be changed or deleted.');
    const last = current?.pending.at(-1);
    const base = last ? { revision: last.write.baseRevision + 1, body: current?.draft ?? null } : current?.confirmed ?? { revision: 0, body: null };
    const pending = this.identity.kind === 'user' ? await this.prepare(documentId, input.kind, base, body) : null;
    return this.store.transact(this.identity, (next) => {
      if (next.epoch !== state.epoch) throw new Error('Identity data was discarded while saving.');
      const document = next.documents.find((item) => item.documentId === documentId);
      requireGeneration(document, input.expectedGeneration);
      const saved: LocalDocument = document ?? {
        documentId, kind: input.kind, generation: 0, confirmed: { revision: 0, body: null }, draft: null,
        pending: [], delivery: { kind: 'waiting' }, receipt: null,
      };
      if (pending) { addOperation(next, pending); saved.pending.push(pending); }
      saved.draft = body;
      saved.generation++;
      if (!document) next.documents.push(saved);
      return saved;
    });
  }

  /** Sends at most one write. Call again on foreground, retry, or receipt until the outbox drains. */
  async syncNext(documentId: string): Promise<void> {
    if (this.identity.kind === 'guest') return;
    const userId = this.identity.id;
    await this.store.exclusive(this.identity, documentId, async () => {
      const state = await this.read();
      const document = state.documents.find((item) => item.documentId === documentId);
      const pending = document?.pending[0];
      if (!document || !pending) return;
      if (document.delivery.kind === 'conflict') {
        // A crash after recording a conflict must not strand an automatic merge.
        await this.mergeAutomatically(documentId);
        return;
      }
      // Mark uncertainty before network I/O, so a killed process retries the same bytes on restart.
      const active = await this.store.transact(this.identity, (next) => {
        const current = next.documents.find((item) => item.documentId === documentId);
        if (next.epoch !== state.epoch || current?.pending[0]?.write.operationId !== pending.write.operationId) return false;
        current.delivery = { kind: 'retrying' };
        return true;
      });
      if (!active) return;
      let response: PushResult;
      try { response = await this.io.push(userId, pending.bytes); } catch { return; }
      if (response.kind === 'receipt') {
        const receipt = ReceiptSchema.parse(response.receipt);
        if (receipt.userId !== userId || receipt.operationId !== pending.write.operationId || receipt.writeSha256 !== pending.sha256 || receipt.committedRevision !== pending.write.baseRevision + 1) {
          throw new Error('Receipt does not confirm the pending write.');
        }
        await this.store.transact(this.identity, (next) => {
          const current = next.documents.find((item) => item.documentId === documentId);
          if (next.epoch !== state.epoch || current?.pending[0]?.write.operationId !== pending.write.operationId) return;
          current.pending.shift();
          current.confirmed = { revision: receipt.committedRevision, body: parseBody(current.kind, pending.write.body) };
          current.receipt = receipt;
          current.delivery = { kind: 'waiting' };
          // A save prepared against the old queue must retry its local compare-and-set.
          current.generation++;
        });
      } else if (response.kind === 'needs-sign-in') {
        await this.store.transact(this.identity, (next) => {
          const current = next.documents.find((item) => item.documentId === documentId);
          if (next.epoch === state.epoch && current?.pending[0]?.write.operationId === pending.write.operationId) current.delivery = { kind: 'needs-sign-in' };
        });
      } else {
        const latest = remoteSnapshot(response.latest, documentId, document.kind);
        if (latest.revision <= pending.write.baseRevision) throw new Error('Conflict response must contain a newer revision.');
        await this.flagConflict(documentId, latest, state.epoch);
        await this.mergeAutomatically(documentId);
      }
    });
  }

  private async flagConflict(documentId: string, latest: Snapshot, epoch: number): Promise<void> {
    await this.store.transact(this.identity, (state) => {
      const current = state.documents.find((item) => item.documentId === documentId);
      if (state.epoch !== epoch || !current?.pending.length) return;
      current.delivery = { kind: 'conflict', latest };
      current.generation++;
    });
  }

  async conflict(documentId: string): Promise<ConflictResolution | null> {
    const document = (await this.read()).documents.find((item) => item.documentId === documentId);
    if (document?.delivery.kind !== 'conflict') return null;
    return resolveConflict(document.kind, document.pending[0]?.baseBody ?? null, document.draft, document.delivery.latest.body);
  }

  private async mergeAutomatically(documentId: string): Promise<void> {
    const state = await this.read();
    const document = state.documents.find((item) => item.documentId === documentId);
    if (document?.delivery.kind !== 'conflict') return;
    const resolution = resolveConflict(document.kind, document.pending[0]?.baseBody ?? null, document.draft, document.delivery.latest.body);
    if (resolution.kind === 'merged') await this.replaceConflict(state, document, resolution.body);
  }

  private async replaceConflict(state: StoreState, document: LocalDocument, body: Body | null): Promise<void> {
    if (document.delivery.kind !== 'conflict') throw new Error('No conflict to resolve.');
    const latest = document.delivery.latest;
    const pending = await this.prepare(document.documentId, document.kind, latest, body);
    await this.store.transact(this.identity, (next) => {
      const current = next.documents.find((item) => item.documentId === document.documentId);
      if (next.epoch !== state.epoch) throw new Error('Identity data was discarded while resolving.');
      requireGeneration(current, document.generation);
      if (!current || current.delivery.kind !== 'conflict') throw new Error('Conflict changed while resolving.');
      addOperation(next, pending);
      current.confirmed = latest;
      current.draft = body;
      current.pending = [pending];
      current.receipt = null;
      current.delivery = { kind: 'waiting' };
      current.generation++;
    });
  }

  /** Explicit answers/reapplied edits, based on the conflict the student actually saw. */
  async resolve(documentId: string, expectedGeneration: number, choice: { kind: 'use-latest' } | { kind: 'write'; body: unknown }): Promise<void> {
    await this.store.exclusive(this.identity, documentId, async () => {
      const state = await this.read();
      const document = state.documents.find((item) => item.documentId === documentId);
      requireGeneration(document, expectedGeneration);
      if (document?.delivery.kind !== 'conflict') throw new Error('No conflict to resolve.');
      if (choice.kind === 'write') {
        if (document.kind === 'version') throw new Error('A version cannot be overwritten.');
        if (document.delivery.latest.body === null && choice.body !== null) throw new Error('A deleted document cannot be resurrected. Save a new document id.');
        await this.replaceConflict(state, document, parseBody(document.kind, choice.body));
      } else {
        await this.store.transact(this.identity, (next) => {
          if (next.epoch !== state.epoch) throw new Error('Identity data was discarded while resolving.');
          const current = next.documents.find((item) => item.documentId === documentId);
          requireGeneration(current, expectedGeneration);
          if (!current || current.delivery.kind !== 'conflict') throw new Error('No conflict to resolve.');
          current.confirmed = current.delivery.latest;
          current.draft = current.delivery.latest.body;
          current.pending = [];
          current.receipt = null;
          current.delivery = { kind: 'waiting' };
          current.generation++;
        });
      }
    });
  }

  async pull(list: unknown): Promise<void> {
    if (this.identity.kind === 'guest') return;
    const initial = await this.read();
    const userId = this.identity.id;
    for (const action of reconcilePull(initial.documents, list)) {
      if (action.kind === 'retry-write') { await this.syncNext(action.documentId); continue; }
      await this.store.exclusive(this.identity, action.entry.documentId, async () => {
        const remote: RemoteDocument = action.entry.deleted
          ? { ...action.entry, schemaVersion: 1, body: null }
          : await this.io.fetch(userId, action.entry.documentId);
        const latest = remoteSnapshot(remote, action.entry.documentId, action.entry.kind);
        if (latest.revision < action.entry.revision) throw new Error('Fetched document predates the pull list.');
        await this.store.transact(this.identity, (state) => {
          if (state.epoch !== initial.epoch) return;
          const current = state.documents.find((item) => item.documentId === action.entry.documentId);
          if (current && current.kind !== action.entry.kind) throw new Error('Pull changed a local document kind.');
          if (current && current.confirmed.revision >= latest.revision) return;
          if (current?.delivery.kind === 'conflict' && current.delivery.latest.revision >= latest.revision) return;
          if (current?.pending.length) {
            if (current.delivery.kind === 'retrying' || current.delivery.kind === 'needs-sign-in') return;
            current.delivery = { kind: 'conflict', latest };
            current.generation++;
          } else if (current) {
            current.confirmed = latest; current.draft = latest.body; current.receipt = null;
            current.generation++; current.delivery = { kind: 'waiting' };
          } else {
            state.documents.push({ documentId: action.entry.documentId, kind: action.entry.kind, generation: 1, confirmed: latest, draft: latest.body, pending: [], delivery: { kind: 'waiting' }, receipt: null });
          }
        });
        await this.mergeAutomatically(action.entry.documentId);
      });
    }
  }

  /** The UI must obtain the explicit discard choice when this returns true. */
  async hasUnsyncedChanges(): Promise<boolean> {
    return (await this.read()).documents.some((document) => document.pending.length > 0);
  }

  async clearLocalData(options: { discardPending: boolean }): Promise<void> {
    await this.store.transact(this.identity, (state) => {
      if (!options.discardPending && state.documents.some((document) => document.pending.length > 0)) throw new Error('Unsynced changes require an explicit discard choice.');
      state.epoch++;
      state.documents = [];
      state.usedOperationIds = [];
    });
  }
}
