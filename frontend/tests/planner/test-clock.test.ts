import { afterEach, beforeEach, expect, test } from "bun:test";
import { TestClock } from "./test-clock";

let clock: TestClock;
const settle = async () => { await Promise.resolve(); };

beforeEach(() => {
  clock = new TestClock();
  clock.install();
});
afterEach(() => clock.restore());

test("timeouts fire at their deadline in registration order and receive arguments", async () => {
  const calls: string[] = [];
  setTimeout((value: string) => calls.push(value), 350, "first");
  setTimeout(() => calls.push("second"), 350);
  await clock.advance(349, settle);
  expect(calls).toEqual([]);
  await clock.advance(1, settle);
  expect(calls).toEqual(["first", "second"]);
});

test("settles promises between deadlines so they can cancel and schedule timers", async () => {
  const calls: string[] = [];
  const cancelled = setTimeout(() => calls.push("cancelled"), 20);
  setTimeout(() => {
    void Promise.resolve().then(() => {
      clearTimeout(cancelled);
      setTimeout(() => calls.push("nested"), 5);
    });
    calls.push("first");
  }, 10);
  await clock.advance(20, settle);
  expect(calls).toEqual(["first", "nested"]);
});

test("zero and negative delays wait for an explicit advance", async () => {
  const calls: number[] = [];
  setTimeout(() => calls.push(1));
  setTimeout(() => calls.push(2), -10);
  expect(calls).toEqual([]);
  await clock.advance(0, settle);
  expect(calls).toEqual([1, 2]);
});

test("invalid advances and recursively scheduled timers fail with specific errors", async () => {
  for (const ms of [-1, NaN, Infinity]) {
    await expect(clock.advance(ms, settle)).rejects.toThrow("finite non-negative duration");
  }
  const repeat = () => { setTimeout(repeat, 0); };
  repeat();
  await expect(clock.advance(0, settle)).rejects.toThrow("exceeded 1000 callbacks");
});

test("restoring clears pending timers and reinstates the original timer functions", async () => {
  clock.restore();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  clock.install();
  let fired = false;
  setTimeout(() => { fired = true; }, 1);
  clock.restore();
  expect(globalThis.setTimeout).toBe(originalSet);
  expect(globalThis.clearTimeout).toBe(originalClear);
  clock.install();
  await clock.advance(1, settle);
  expect(fired).toBe(false);
});
