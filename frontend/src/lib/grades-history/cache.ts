import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { GradesError } from "./errors";
import { object } from "./client";

// One day is a cache policy for historical records, not a measured freshness guarantee.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export interface GradesCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class GradesDiskCache implements GradesCache {
  constructor(private readonly directory: string, private readonly ttlMs = CACHE_TTL_MS, private readonly now = Date.now) {}
  private file(key: string) { return path.join(this.directory, createHash("sha256").update(key).digest("hex") + ".json"); }

  async get(key: string): Promise<unknown | undefined> {
    let text: string;
    try { text = await readFile(this.file(key), "utf8"); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new GradesError("storage", "Grade history cache cannot be read");
    }
    let record: Record<string, unknown>;
    try { record = object(JSON.parse(text), "cache record"); } catch { throw new GradesError("storage", "Grade history cache contains invalid JSON"); }
    if (record.version !== 1 || typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) || !("value" in record)) throw new GradesError("storage", "Grade history cache record is malformed");
    return record.expiresAt <= this.now() ? undefined : record.value;
  }

  async remove(key: string) {
    try { await rm(this.file(key), { force: true }); }
    catch { throw new GradesError("storage", "Grade history cache cannot be invalidated"); }
  }

  async set(key: string, value: unknown) {
    const target = this.file(key);
    try {
      await mkdir(this.directory, { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 1, expiresAt: this.now() + this.ttlMs, value }), { mode: 0o600 });
      await rename(temp, target);
    } catch { throw new GradesError("storage", "Grade history cache cannot be written"); }
  }
}
