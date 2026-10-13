import { GradesError } from "./errors";

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const systemClock: Clock = { now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export class GradesLimiter {
  private minuteTokens = 1;
  private hourTokens = 300;
  private refilledAt: number;
  private sent: number[] = [];
  private blockedUntil = 0;

  // The permit wait bounds route queueing; it does not change the source budget.
  constructor(private readonly clock: Clock = systemClock, private readonly maxWaitMs = 15_000) {
    this.refilledAt = clock.now();
  }

  cooldown(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + ms);
  }

  async acquire() {
    const deadline = this.clock.now() + this.maxWaitMs;
    for (;;) {
      const now = this.clock.now();
      const elapsed = Math.max(0, now - this.refilledAt);
      // Capacity one paces requests at 20/min. The rolling window also caps
      // the hour bucket's initial burst plus refill at the requested 300/h.
      this.minuteTokens = Math.min(1, this.minuteTokens + elapsed / 3_000);
      this.hourTokens = Math.min(300, this.hourTokens + elapsed / 12_000);
      this.refilledAt = now;
      this.sent = this.sent.filter((time) => time > now - 3_600_000);
      const wait = Math.max(
        0, this.blockedUntil - now,
        (1 - this.minuteTokens) * 3_000,
        (1 - this.hourTokens) * 12_000,
        this.sent.length >= 300 ? this.sent[0] + 3_600_000 - now : 0,
      );
      if (wait <= 0) {
        // No await between checking and consuming, so concurrent callers share one permit.
        this.minuteTokens -= 1;
        this.hourTokens -= 1;
        this.sent.push(now);
        return;
      }
      if (now + wait > deadline) {
        throw new GradesError("throttled", "untgrades.app request budget is busy", Math.ceil(wait / 1_000));
      }
      await this.clock.sleep(Math.ceil(wait));
    }
  }
}

// Shared across service instances and concurrent requests in this server process.
export const gradesLimiter = new GradesLimiter();
