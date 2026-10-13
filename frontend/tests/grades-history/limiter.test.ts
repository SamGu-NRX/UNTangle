import { expect, test } from "bun:test";
import { GradesLimiter } from "@/lib/grades-history/limiter";

function manualClock() {
  let now = 0;
  let sleepers: Array<{ at: number; resolve: () => void }> = [];
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => { sleepers.push({ at: now + ms, resolve }); }),
    advance(ms: number) {
      now += ms;
      const due = sleepers.filter((s) => s.at <= now);
      sleepers = sleepers.filter((s) => s.at > now);
      due.forEach((s) => s.resolve());
    },
  };
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

test("concurrent callers receive distinct paced permits", async () => {
  const clock = manualClock();
  const limiter = new GradesLimiter(clock, 30_000);
  const accepted: number[] = [];
  const callers = Array.from({ length: 8 }, () => limiter.acquire().then(() => accepted.push(clock.now())));
  await settle();
  expect(accepted).toEqual([0]);
  for (let i = 0; i < 7; i++) { clock.advance(3_000); await settle(); }
  await Promise.all(callers);
  expect(accepted).toEqual([0, 3_000, 6_000, 9_000, 12_000, 15_000, 18_000, 21_000]);
});

test("hour bucket plus rolling window caps 300/h even after initial tokens refill", async () => {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const limiter = new GradesLimiter(clock);
  const accepted: number[] = [];
  for (let i = 0; i < 300; i++) { await limiter.acquire(); accepted.push(now); }
  expect(accepted.slice(0, 3)).toEqual([0, 3_000, 6_000]);
  expect(accepted[299]).toBe(897_000);
  await expect(limiter.acquire()).rejects.toMatchObject({ reason: "throttled", retryAfterSeconds: 2_703 });
  now = 3_600_000;
  await limiter.acquire();
  expect(now).toBe(3_600_000);
  await limiter.acquire();
  expect(now).toBe(3_603_000);
});

test("cooldown affects sleeping callers and cannot be shortened", async () => {
  const clock = manualClock();
  const limiter = new GradesLimiter(clock, 20_000);
  await limiter.acquire();
  const accepted: number[] = [];
  const waiting = limiter.acquire().then(() => accepted.push(clock.now()));
  limiter.cooldown(10_000);
  limiter.cooldown(1_000);
  clock.advance(3_000);
  await settle();
  expect(accepted).toEqual([]);
  clock.advance(7_000);
  await waiting;
  expect(accepted).toEqual([10_000]);
});
