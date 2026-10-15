import { PullListSchema, type PullEntry } from '@untangle/contracts/sync';
import type { LocalDocument } from './store';

export type PullAction =
  | { kind: 'fetch'; entry: PullEntry }
  | { kind: 'apply-delete'; entry: PullEntry }
  | { kind: 'conflict'; entry: PullEntry }
  | { kind: 'retry-write'; documentId: string };

/** Missing list entries are not tombstones. Never infer deletion from absence. */
export function reconcilePull(documents: readonly LocalDocument[], input: unknown): PullAction[] {
  const list = PullListSchema.parse(input);
  return list.flatMap((entry): PullAction[] => {
    const local = documents.find((document) => document.documentId === entry.documentId);
    if (local && local.kind !== entry.kind) throw new Error(`Pull changed the kind of ${entry.documentId}.`);
    if (local && entry.revision <= local.confirmed.revision) return [];
    if (local?.pending.length) {
      // The listed revision could be our committed write. Obtain its receipt before rebasing anything.
      if (local.delivery.kind === 'retrying' || local.delivery.kind === 'needs-sign-in') {
        return [{ kind: 'retry-write', documentId: entry.documentId }];
      }
      return [{ kind: 'conflict', entry }];
    }
    return [{ kind: entry.deleted ? 'apply-delete' : 'fetch', entry }];
  });
}
