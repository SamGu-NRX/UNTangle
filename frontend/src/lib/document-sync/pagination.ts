import { DocumentIdSchema } from "../../../../packages/contracts/src/ids";
import { SyncError } from "./decision";

export type VersionCursor = { createdAt: Date; id: string };

export function encodePage(cursor: VersionCursor, scheduleId: string | null): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id, scheduleId])).toString("base64url");
}

export function decodePage(page: string | null, scheduleId: string | null): VersionCursor | null {
  if (page === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(page)) throw new Error();
    const values: unknown = JSON.parse(Buffer.from(page, "base64url").toString("utf8"));
    if (!Array.isArray(values) || values.length !== 3 || typeof values[0] !== "string" || values[2] !== scheduleId) throw new Error();
    const id = DocumentIdSchema.parse(values[1]);
    const createdAt = new Date(values[0]);
    if (createdAt.toISOString() !== values[0]) throw new Error();
    return { createdAt, id };
  } catch { throw new SyncError(400, "INVALID_PAGE", "The version page is invalid for this schedule."); }
}
