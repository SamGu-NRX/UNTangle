import type { Identity, LocalDocument } from './store';

export type SyncStatus =
  | 'Saved on this device'
  | 'Waiting to sync'
  | 'Synced'
  | 'Needs sign-in'
  | 'Resolve conflict'
  | 'Save not confirmed (retrying)';

/** Pulling a document is not a write receipt. A fresh pull stays locally saved. */
export function syncStatus(identity: Identity, document: LocalDocument): SyncStatus {
  if (identity.kind === 'guest') return 'Saved on this device';
  if (document.delivery.kind === 'conflict') return 'Resolve conflict';
  if (document.pending.length) {
    switch (document.delivery.kind) {
      case 'waiting': return 'Waiting to sync';
      case 'retrying': return 'Save not confirmed (retrying)';
      case 'needs-sign-in': return 'Needs sign-in';
    }
  }
  return document.receipt?.committedRevision === document.confirmed.revision
    ? 'Synced' : 'Saved on this device';
}
