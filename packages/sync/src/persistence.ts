import { documentBodySchemas, DocumentKindSchema } from '@untangle/contracts/documents';
import { DocumentIdSchema } from '@untangle/contracts/ids';
import { ReceiptSchema, WriteSchema } from '@untangle/contracts/sync';
import { equal } from './conflicts';
import { emptyState, type Body, type Delivery, type Identity, type LocalDocument, type PendingWrite, type Snapshot, type StoreState } from './store';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Stored sync value must be an object.');
  return Object.fromEntries(Object.entries(value));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Stored sync value must be an array.');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Stored sync counter must be a nonnegative safe integer.');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Stored sync value must be a string.');
  return value;
}

/** Reject incompatible/corrupt storage without clearing it or fabricating an empty outbox. */
export function parseStoreState(value: unknown, identity: Identity): StoreState {
  if (value === undefined) return emptyState();
  const stored = object(value);
  if (stored.format !== 1) throw new Error('Unsupported local sync storage format.');
  const state = object(stored.state);
  const usedOperationIds = array(state.usedOperationIds).map(string);
  if (new Set(usedOperationIds).size !== usedOperationIds.length) throw new Error('Duplicate stored operation id.');
  const documents = array(state.documents).map((value): LocalDocument => {
    const doc = object(value);
    const kind = DocumentKindSchema.parse(doc.kind);
    const documentId = DocumentIdSchema.parse(doc.documentId);
    const body = (value: unknown): Body | null => value === null ? null : documentBodySchemas[kind].parse(value);
    const snapshot = (value: unknown): Snapshot => {
      const source = object(value);
      const parsed = { revision: integer(source.revision), body: body(source.body) };
      if (parsed.revision === 0 && parsed.body !== null) throw new Error('An uncommitted snapshot cannot have a server body.');
      return parsed;
    };
    const confirmed = snapshot(doc.confirmed);
    const draft = body(doc.draft);
    const pending = array(doc.pending).map((value): PendingWrite => {
      const source = object(value);
      const write = WriteSchema.parse(source.write);
      const bytes = string(source.bytes), sha256 = string(source.sha256);
      if (!equal(WriteSchema.parse(JSON.parse(bytes)), write) || write.kind !== kind || write.documentId !== documentId || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Stored outbox does not match its serialized write.');
      body(write.body);
      if (!usedOperationIds.includes(write.operationId)) throw new Error('Stored outbox operation is not registered.');
      return { write, bytes, sha256, baseBody: body(source.baseBody) };
    });
    for (let i = 0; i < pending.length; i++) {
      const baseBody = i === 0 ? confirmed.body : pending[i - 1].write.body;
      // A first write may name the starting values it was made on (SyncEngine.save's startedFrom).
      const firstWrite = i === 0 && confirmed.revision === 0;
      if (pending[i].write.baseRevision !== confirmed.revision + i || (!firstWrite && !equal(pending[i].baseBody, baseBody))) throw new Error('Stored outbox revision chain is broken.');
    }
    if (pending.length && !equal(draft, pending.at(-1)?.write.body)) throw new Error('Stored draft does not match its final pending write.');
    if (identity.kind === 'guest' && pending.length) throw new Error('A guest cannot have a sync outbox.');
    const sourceDelivery = object(doc.delivery);
    let delivery: Delivery;
    switch (sourceDelivery.kind) {
      case 'waiting': case 'retrying': case 'needs-sign-in': delivery = { kind: sourceDelivery.kind }; break;
      case 'conflict': delivery = { kind: 'conflict', latest: snapshot(sourceDelivery.latest) }; break;
      default: throw new Error('Unknown stored delivery state.');
    }
    if (delivery.kind !== 'waiting' && !pending.length) throw new Error('Stored delivery state has no pending write.');
    const receipt = doc.receipt === null ? null : ReceiptSchema.parse(doc.receipt);
    if (receipt && (identity.kind !== 'user' || receipt.userId !== identity.id || receipt.committedRevision !== confirmed.revision)) throw new Error('Stored receipt belongs to another identity or revision.');
    return { documentId, kind, generation: integer(doc.generation), confirmed, draft, pending, delivery, receipt };
  });
  if (new Set(documents.map((doc) => doc.documentId)).size !== documents.length) throw new Error('Duplicate stored document id.');
  return { epoch: integer(state.epoch), documents, usedOperationIds };
}
