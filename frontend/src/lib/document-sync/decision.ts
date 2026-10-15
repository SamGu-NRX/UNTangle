import { createHash } from "node:crypto";
import { documentBodySchemas, type DocumentKind, type VersionBody } from "../../../../packages/contracts/src/documents";
import { WriteSchema, type Receipt, type Write } from "../../../../packages/contracts/src/sync";

export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly revision?: number,
  ) { super(message); }
}

/** Hash the received bytes, before JSON parsing can reorder keys or change whitespace. */
export function parseWrite(bytes: Uint8Array): { write: Write; writeSha256: string } {
  let json: unknown;
  try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new SyncError(400, "INVALID_JSON", "The write must be valid UTF-8 JSON."); }
  const parsed = WriteSchema.safeParse(json);
  if (!parsed.success) throw new SyncError(400, "INVALID_WRITE", "The write does not match WriteSchema.");
  return { write: parsed.data, writeSha256: createHash("sha256").update(bytes).digest("hex") };
}

export type CurrentDocument = {
  kind: DocumentKind;
  revision: number;
  institutionId: string;
  deleted: boolean;
};

type Commit =
  | { kind: "document"; revision: number; institutionId: string; body: Exclude<Write["body"], null>; deleted: false }
  | { kind: "document"; revision: number; institutionId: string; body: null; deleted: true }
  | { kind: "version"; body: VersionBody };

export type Decision = { kind: "replay"; receipt: Receipt } | Commit;

/** Receipt lookup precedes every state check, including a tombstone or a later revision. */
export function decideWrite({ write, writeSha256, receipt, current }: {
  write: Write;
  writeSha256: string;
  receipt: Receipt | null;
  current: CurrentDocument | null;
}): Decision {
  if (receipt) {
    if (receipt.writeSha256 !== writeSha256) {
      throw new SyncError(409, "OPERATION_REUSED", "This operation id already committed different bytes.");
    }
    return { kind: "replay", receipt };
  }
  if (current && current.kind !== write.kind) {
    throw new SyncError(409, "KIND_MISMATCH", "A document's kind cannot change.");
  }
  if (write.baseRevision !== (current?.revision ?? 0)) {
    throw new SyncError(409, "REVISION_CONFLICT", "The document has changed. Fetch its current revision.", current?.revision ?? 0);
  }
  if (write.kind === "version") {
    if (current || write.baseRevision !== 0 || write.body === null) {
      throw new SyncError(409, "VERSION_IMMUTABLE", "Versions can only be created.");
    }
    const body = documentBodySchemas.version.safeParse(write.body);
    if (!body.success) throw new SyncError(400, "INVALID_BODY", "The version body is invalid.");
    return { kind: "version", body: body.data };
  }
  // A deletion of an unknown id cannot establish its institution. Clients must fetch it first.
  if (!current && write.body === null) {
    throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
  }
  const revision = (current?.revision ?? 0) + 1;
  if (write.body === null && current) {
    return { kind: "document", revision, institutionId: current.institutionId, body: null, deleted: true };
  }
  const body = documentBodySchemas[write.kind].safeParse(write.body);
  if (!body.success) throw new SyncError(400, "INVALID_BODY", "The body does not match its document kind.");
  if (current && current.institutionId !== body.data.institutionId) {
    throw new SyncError(409, "INSTITUTION_MISMATCH", "A document's institution cannot change.");
  }
  return { kind: "document", revision, institutionId: body.data.institutionId, body: body.data, deleted: false };
}
