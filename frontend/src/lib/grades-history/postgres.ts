import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { gradesHistoryBudget, gradesHistoryCache } from "@/lib/db/schema";
import { CACHE_TTL_MS } from "./cache";
import type { GradesCache } from "./cache";
import { GradesError } from "./errors";
import { systemClock } from "./limiter";
import type { Clock, GradesRequestLimiter } from "./limiter";

type CacheDatabase = Pick<NodePgDatabase, "select" | "insert" | "delete">;

export class GradesPostgresCache implements GradesCache {
  constructor(private readonly db: CacheDatabase) {}

  async get(key: string): Promise<unknown | undefined> {
    try {
      const [row] = await this.db.select({ record: gradesHistoryCache.record,
        expired: sql`${gradesHistoryCache.expiresAt} <= clock_timestamp()`.mapWith(Boolean),
      }).from(gradesHistoryCache).where(eq(gradesHistoryCache.key, key));
      if (!row) return undefined;
      const record = row.record;
      if (typeof record !== "object" || record === null || !("version" in record) || record.version !== 1 || !("value" in record)) {
        throw new Error("Malformed cache record");
      }
      return row.expired ? undefined : record.value;
    } catch {
      throw new GradesError("storage", "Grade history cache cannot be read");
    }
  }

  async set(key: string, value: unknown) {
    try {
      const record = { version: 1, value };
      const expiresAt = sql`clock_timestamp() + ${CACHE_TTL_MS} * interval '1 millisecond'`;
      await this.db.insert(gradesHistoryCache).values({ key, record, expiresAt })
        .onConflictDoUpdate({ target: gradesHistoryCache.key, set: { record, expiresAt } });
    } catch {
      throw new GradesError("storage", "Grade history cache cannot be written");
    }
  }

  async remove(key: string) {
    try { await this.db.delete(gradesHistoryCache).where(eq(gradesHistoryCache.key, key)); }
    catch { throw new GradesError("storage", "Grade history cache cannot be invalidated"); }
  }
}

const SOURCE = "untgrades.app";
const HOUR_MS = 3_600_000;
const initialBudget = { source: SOURCE, nextPermitAt: new Date(0), cooldownUntil: new Date(0), sentAt: [] };

export class GradesPostgresLimiter implements GradesRequestLimiter {
  constructor(
    private readonly db: Pick<NodePgDatabase, "transaction">,
    private readonly clock: Clock = systemClock,
    private readonly maxWaitMs = 15_000,
  ) {}

  private async permitWait(): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.insert(gradesHistoryBudget).values(initialBudget).onConflictDoNothing();
        const [budget] = await tx.select().from(gradesHistoryBudget)
          .where(eq(gradesHistoryBudget.source, SOURCE)).for("update");
        // Read database time after acquiring the lock, so neither instance clock
        // skew nor time spent waiting for another transaction creates a permit.
        const [time] = await tx.select({ now: sql`floor(extract(epoch from clock_timestamp()) * 1000)`.mapWith(Number) })
          .from(gradesHistoryBudget).where(eq(gradesHistoryBudget.source, SOURCE));
        const now = time.now;
        const sent = budget.sentAt.filter((at) => at > now - HOUR_MS);
        const wait = Math.max(0, budget.nextPermitAt.getTime() - now, budget.cooldownUntil.getTime() - now,
          sent.length >= 300 ? sent[0] + HOUR_MS - now : 0);
        if (wait === 0) {
          // Capacity one, spaced at 3 seconds, enforces 20 per rolling minute.
          // Keep at most one hour of permits to enforce the separate 300/h cap.
          await tx.update(gradesHistoryBudget).set({ nextPermitAt: new Date(now + 3_000), sentAt: [...sent, now] })
            .where(eq(gradesHistoryBudget.source, SOURCE));
        }
        return wait;
      });
    } catch {
      throw new GradesError("storage", "Grade history request budget cannot be read or written");
    }
  }

  async acquire() {
    const deadline = this.clock.now() + this.maxWaitMs;
    if (this.maxWaitMs === 0) return this.acquireUntil(deadline);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound the whole wait, including pool checkout and database replies.
      // A timed-out transaction may conservatively spend a permit, but its
      // caller cannot use it to send an upstream request.
      await Promise.race([
        this.acquireUntil(deadline),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(this.busy(1_000)), this.maxWaitMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  private busy(wait: number) {
    return new GradesError("throttled", "untgrades.app request budget is busy", Math.max(1, Math.ceil(wait / 1_000)));
  }

  private async acquireUntil(deadline: number) {
    for (;;) {
      if (this.clock.now() > deadline) throw this.busy(1_000);
      const wait = await this.permitWait();
      const now = this.clock.now();
      if (now > deadline || now + wait > deadline) throw this.busy(wait);
      if (wait === 0) return;
      await this.clock.sleep(wait);
    }
  }

  async cooldown(ms: number) {
    try {
      // The upsert takes the same row lock as permit spending. A shorter
      // Retry-After can never undo a longer cooldown from another instance.
      const until = sql`clock_timestamp() + ${ms} * interval '1 millisecond'`;
      await this.db.transaction(async (tx) => {
        await tx.insert(gradesHistoryBudget).values({ ...initialBudget, cooldownUntil: until })
          .onConflictDoUpdate({ target: gradesHistoryBudget.source,
            set: { cooldownUntil: sql`greatest(${gradesHistoryBudget.cooldownUntil}, ${until})` } });
      });
    } catch {
      throw new GradesError("storage", "Grade history request cooldown cannot be written");
    }
  }
}
