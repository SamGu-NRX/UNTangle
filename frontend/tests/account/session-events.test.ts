import { describe, expect, test } from "bun:test";
import {
  isExemptPath,
  notifySessionExpired,
  notifySessionRestored,
  onSessionExpired,
  onSessionRestored,
  pollForSessionRestored,
} from "@/lib/session-events";

describe("session expiry events", () => {
  test("notifySessionExpired calls every subscribed handler", () => {
    let first = 0;
    let second = 0;
    const off1 = onSessionExpired(() => {
      first += 1;
    });
    const off2 = onSessionExpired(() => {
      second += 1;
    });
    notifySessionExpired();
    expect(first).toBe(1);
    expect(second).toBe(1);
    off1();
    off2();
  });

  test("the restored channel is independent of the expired channel", () => {
    let expired = 0;
    let restored = 0;
    const offExpired = onSessionExpired(() => {
      expired += 1;
    });
    const offRestored = onSessionRestored(() => {
      restored += 1;
    });
    notifySessionExpired();
    expect(restored).toBe(0);
    notifySessionRestored();
    expect(expired).toBe(1);
    expect(restored).toBe(1);
    offExpired();
    offRestored();
  });

  test("unsubscribe stops delivery", () => {
    let calls = 0;
    const off = onSessionRestored(() => {
      calls += 1;
    });
    off();
    notifySessionRestored();
    expect(calls).toBe(0);
  });

  test("a handler that unsubscribes during dispatch does not break other handlers", () => {
    let lateCalls = 0;
    let survivorCalls = 0;
    let offLate: (() => void) | null = null;
    const offSurvivor = onSessionExpired(() => {
      survivorCalls += 1;
    });
    offLate = onSessionExpired(() => {
      lateCalls += 1;
      if (offLate) offLate();
    });
    notifySessionExpired();
    notifySessionExpired();
    expect(lateCalls).toBe(1);
    expect(survivorCalls).toBe(2);
    offSurvivor();
  });
});

describe("isExemptPath", () => {
  test("exempts the sign-in page and developer tooling", () => {
    expect(isExemptPath("/sign-in")).toBe(true);
    expect(isExemptPath("/dev/outbox")).toBe(true);
  });

  test("shows the overlay on app pages, including an unknown path", () => {
    expect(isExemptPath("/courses")).toBe(false);
    expect(isExemptPath("/")).toBe(false);
    expect(isExemptPath(null)).toBe(false);
  });
});

describe("pollForSessionRestored", () => {
  test("emits onSessionRestored and returns true once the probe reports a user", async () => {
    let calls = 0;
    const fetchLike = (async () => {
      calls += 1;
      return new Response(JSON.stringify(calls < 2 ? null : { user: { id: "u1" } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    let restored = 0;
    const off = onSessionRestored(() => {
      restored += 1;
    });
    const cameBack = await pollForSessionRestored({
      fetchLike,
      intervalMs: 0,
      maxAttempts: 5,
      delay: async () => {},
    });
    off();
    expect(cameBack).toBe(true);
    expect(restored).toBe(1);
    expect(calls).toBe(2);
  });

  test("returns false and emits nothing when the session never reappears", async () => {
    const fetchLike = (async () =>
      new Response(JSON.stringify(null), { status: 200 })) as unknown as typeof fetch;
    let restored = 0;
    const off = onSessionRestored(() => {
      restored += 1;
    });
    const cameBack = await pollForSessionRestored({
      fetchLike,
      intervalMs: 0,
      maxAttempts: 4,
      delay: async () => {},
    });
    off();
    expect(cameBack).toBe(false);
    expect(restored).toBe(0);
  });

  test("treats server errors as an absent session and keeps polling", async () => {
    let calls = 0;
    const fetchLike = (async () => {
      calls += 1;
      return calls < 3
        ? new Response("nope", { status: 500 })
        : new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const cameBack = await pollForSessionRestored({
      fetchLike,
      intervalMs: 0,
      maxAttempts: 5,
      delay: async () => {},
    });
    expect(cameBack).toBe(true);
    expect(calls).toBe(3);
  });
});
