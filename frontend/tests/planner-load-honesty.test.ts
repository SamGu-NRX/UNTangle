import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ensureTestDom, setSession } from "./helpers/planner-test-dom";

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => {
      const holder = globalThis as { __UNT_TEST_SESSION__?: unknown };
      return (
        holder.__UNT_TEST_SESSION__ ?? { data: null, isPending: false, error: null }
      );
    },
  },
}));

ensureTestDom();

const { PlannerProvider, usePlanner } = await import("@/components/planner-provider");
const React = (await import("react")).default;
const { render } = await import("@testing-library/react");

type Latest = {
  saveState: { status: string; label: string; detail: string | null; reason: string | null };
  afterHydration: () => Promise<void>;
};

function mountProvider(): Latest {
  let latest: Latest | null = null;
  function Probe() {
    latest = usePlanner() as unknown as Latest;
    return null;
  }
  render(React.createElement(PlannerProvider, null, React.createElement(Probe)));
  if (!latest) {
    throw new Error("probe did not render");
  }
  return latest;
}

describe("M6 fix 1: load honesty for non-persistent servers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("a reachable but non-persistent load reports Not saved, never Saved", async () => {
    setSession({ id: "u1", email: "student@my.unt.edu", name: "Test Student" });
    const previous = globalThis.fetch;
    let loadCalls = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/planner") && (init?.method ?? "GET") === "GET") {
        loadCalls += 1;
        return new Response(JSON.stringify({ state: null, persistent: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const latest = mountProvider();
      await latest.afterHydration();
      expect(loadCalls).toBe(1);
      expect(latest.saveState.status).toBe("not-saved");
      expect(latest.saveState.label).toBe("Not saved…");
      expect(latest.saveState.reason).toBe("storage");
      expect(latest.saveState.label).not.toBe("Saved");
    } finally {
      globalThis.fetch = previous;
      setSession(null);
    }
  });
});
