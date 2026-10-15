import { AcademicRecordBodySchema, PreferencesBodySchema, ScheduleBodySchema } from '@untangle/contracts/documents';
import type { SyncIO, RemoteDocument } from '../src/engine';
import type { Identity } from '../src/store';

export const user: Identity = { kind: 'user', id: 'student-a' };
export const schedule = (name = 'Main') => ScheduleBodySchema.parse({ institutionId: 'unt', termId: 'spring-2027', name, courses: [], selectedSections: {}, lockedSections: {}, autoPlanned: [], lastAuto: null });
export const preferences = () => PreferencesBodySchema.parse({ institutionId: 'unt', goal: 'compact', constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: null, excludedSections: [], openSeatsOnly: false, otherSites: false }, weights: { fewerDays: 0, compact: 2, mornings: 0, evenings: 0, walking: 0, rating: 0 } });
export const academic = () => AcademicRecordBodySchema.parse({ institutionId: 'unt', courseStatuses: {}, transcriptRecords: [], manualCredit: [], major: null, catalogId: null });
export const hash = async (bytes: string) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
export function io(overrides: Partial<SyncIO> = {}): SyncIO {
  let id = 0;
  return {
    operationId: () => `operation-${++id}`,
    sha256: hash,
    push: async (userId, bytes) => {
      const write = JSON.parse(bytes);
      return { kind: 'receipt', receipt: { userId, operationId: write.operationId, writeSha256: await hash(bytes), committedRevision: write.baseRevision + 1 } };
    },
    fetch: async () => { throw new Error('Unexpected fetch'); },
    ...overrides,
  };
}
export function remote(body: unknown = schedule(), revision = 1, kind: RemoteDocument['kind'] = 'schedule'): RemoteDocument {
  return { documentId: 'doc', kind, revision, schemaVersion: 1, body };
}
