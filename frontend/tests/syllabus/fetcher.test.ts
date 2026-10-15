import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DisallowedByRobots, PoliteFetcher, StopOnHttpError } from "../../../tools/syllabus/lib/fetcher";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fetcher(minDelayMs = 0, stopOnError?: boolean) {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "syllabus-fetcher-"));
  dirs.push(cacheDir);
  return new PoliteFetcher({ cacheDir, minDelayMs, timeoutMs: 10, stopOnError });
}
function mockFetch(implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(implementation, { preconnect: fetch.preconnect }));
}
async function withRobots(text: string, check: (client: PoliteFetcher) => Promise<void>) {
  const mock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(text));
  try { await check(fetcher()); } finally { mock.mockRestore(); }
}

describe("robots availability", () => {
  for (const status of [500, 503, 302]) {
    test(`HTTP ${status} blocks the origin for the run without fetching a syllabus`, async () => {
      const mock = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status }));
      try {
        const client = fetcher();
        await expect(client.fetch("https://example.invalid/syllabus.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
        await expect(client.assertAllowed("https://example.invalid/another.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
        expect(mock).toHaveBeenCalledTimes(1);
        expect(String(mock.mock.calls[0][0])).toBe("https://example.invalid/robots.txt");
      } finally { mock.mockRestore(); }
    });
  }
  for (const error of [new Error("network unavailable"), new DOMException("timed out", "TimeoutError")]) {
    test(`${error.name} blocks the origin for the run`, async () => {
      const mock = spyOn(globalThis, "fetch").mockRejectedValue(error);
      try {
        const client = fetcher();
        await expect(client.assertAllowed("https://example.invalid/syllabus.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
        await expect(client.assertAllowed("https://example.invalid/another.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
        expect(mock).toHaveBeenCalledTimes(1);
      } finally { mock.mockRestore(); }
    });
  }
  for (const status of [404, 403]) {
    test(`HTTP ${status} means no restrictions`, async () => {
      const mock = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status }));
      try { await expect(fetcher().assertAllowed("https://example.invalid/syllabus.pdf")).resolves.toBeUndefined(); }
      finally { mock.mockRestore(); }
    });
  }
});

describe("stop on resource refusal", () => {
  for (const status of [429, 500, 503]) {
    test(`HTTP ${status} stops on the first response by default and prevents later requests`, async () => {
      const requests: string[] = [];
      const pause = spyOn(Bun, "sleep").mockResolvedValue(undefined);
      const mock = mockFetch(async (input) => {
        const url = String(input);
        requests.push(url);
        return url.endsWith("/robots.txt") ? new Response("User-agent: *\n") : new Response("refused", { status });
      });
      try {
        const client = fetcher();
        await expect(client.fetch("https://example.invalid/syllabus.pdf")).rejects.toThrow(`run stopped: https://example.invalid/syllabus.pdf returned HTTP ${status}`);
        await expect(client.fetch("https://other.invalid/next.pdf")).rejects.toBeInstanceOf(StopOnHttpError);
        expect(requests).toEqual(["https://example.invalid/robots.txt", "https://example.invalid/syllabus.pdf"]);
        expect(pause).not.toHaveBeenCalled();
      } finally { mock.mockRestore(); pause.mockRestore(); }
    });
  }
  test("a refusal cancels queued resources and robots requests", async () => {
    const requests: string[] = [];
    let refuse: (() => void) | undefined;
    const mock = mockFetch(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      if (url.endsWith("/first.pdf")) await new Promise<void>((resolve) => { refuse = resolve; });
      return new Response(null, { status: 503 });
    });
    try {
      const client = fetcher();
      await client.assertAllowed("https://example.invalid/first.pdf");
      const first = client.fetch("https://example.invalid/first.pdf");
      while (!refuse) await Promise.resolve();
      const queued = [client.fetch("https://example.invalid/second.pdf"), client.fetch("https://other.invalid/third.pdf")];
      refuse();
      const results = await Promise.allSettled([first, ...queued]);
      expect(results.map((result) => result.status === "rejected" ? result.reason.message : "success")).toEqual(Array(3).fill("run stopped: https://example.invalid/first.pdf returned HTTP 503"));
      expect(requests).toEqual(["https://example.invalid/robots.txt", "https://example.invalid/first.pdf"]);
    } finally { mock.mockRestore(); }
  });
  test("reports the actual redirected URL that refused the request", async () => {
    const mock = mockFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/refused" } });
      return new Response(null, { status: 503 });
    });
    try {
      await expect(fetcher().fetch("https://example.invalid/start")).rejects.toThrow("run stopped: https://example.invalid/refused returned HTTP 503");
      expect(mock).toHaveBeenCalledTimes(3);
    } finally { mock.mockRestore(); }
  });
  test("explicit opt-out retries transient resource responses", async () => {
    let attempts = 0;
    const pause = spyOn(Bun, "sleep").mockResolvedValue(undefined);
    const mock = mockFetch(async (input) => {
      if (String(input).endsWith("/robots.txt")) return new Response("User-agent: *\n");
      attempts++;
      return attempts < 3 ? new Response(null, { status: attempts === 1 ? 429 : 503 }) : new Response("synthetic syllabus");
    });
    try {
      const result = await fetcher(0, false).fetch("https://example.invalid/syllabus.pdf");
      expect(result.body.toString()).toBe("synthetic syllabus");
      expect(attempts).toBe(3);
      expect(pause).toHaveBeenCalledTimes(2);
    } finally { mock.mockRestore(); pause.mockRestore(); }
  });
});

describe("redirect permissions", () => {
  test("checks a same-origin destination before requesting a disallowed path", async () => {
    const requests: string[] = [];
    const mock = mockFetch(async (input, init) => {
      expect(init?.redirect).toBe("manual");
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private");
      if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/private/file.pdf" } });
      throw new Error(`unexpected request: ${url}`);
    });
    try {
      await expect(fetcher().fetch("https://example.invalid/start")).rejects.toBeInstanceOf(DisallowedByRobots);
      expect(requests).toEqual(["https://example.invalid/robots.txt", "https://example.invalid/start"]);
    } finally { mock.mockRestore(); }
  });
  test("fetches cross-origin robots before a redirected resource and stops on a block", async () => {
    const requests: string[] = [];
    const mock = mockFetch(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://source.invalid/robots.txt") return new Response("User-agent: *\n");
      if (url === "https://source.invalid/start") return new Response(null, { status: 307, headers: { location: "https://destination.invalid/file.pdf" } });
      if (url === "https://destination.invalid/robots.txt") return new Response("User-agent: *\nDisallow: /");
      throw new Error(`unexpected request: ${url}`);
    });
    try {
      await expect(fetcher().fetch("https://source.invalid/start")).rejects.toBeInstanceOf(DisallowedByRobots);
      expect(requests).toEqual(["https://source.invalid/robots.txt", "https://source.invalid/start", "https://destination.invalid/robots.txt"]);
    } finally { mock.mockRestore(); }
  });
  test("follows allowed redirects and caches their body under the requested URL", async () => {
    const requests: string[] = [];
    const mock = mockFetch(async (input, init) => {
      expect(init?.redirect).toBe("manual");
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      if (url.endsWith("/start")) return new Response(null, { status: 301, headers: { location: "https://destination.invalid/path/file.pdf" } });
      return new Response("synthetic syllabus", { headers: { "content-type": "text/plain" } });
    });
    try {
      const client = fetcher();
      const result = await client.fetch("https://source.invalid/start");
      expect(result.body.toString()).toBe("synthetic syllabus");
      expect(result.fromCache).toBe(false);
      expect((await client.fetch("https://source.invalid/start")).fromCache).toBe(true);
      expect(requests).toEqual(["https://source.invalid/robots.txt", "https://source.invalid/start", "https://destination.invalid/robots.txt", "https://destination.invalid/path/file.pdf"]);
    } finally { mock.mockRestore(); }
  });
  test("robots redirects are bounded and each hop uses the shared throttle", async () => {
    const starts: number[] = [];
    const mock = mockFetch(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      starts.push(Date.now());
      return new Response(null, { status: 302, headers: { location: "/robots-again" } });
    });
    try {
      await expect(fetcher(20).assertAllowed("https://example.invalid/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
      expect(starts).toHaveLength(6);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(20);
    } finally { mock.mockRestore(); }
  });
});

test("concurrent callers and fetcher instances share a global serialized request queue", async () => {
  const starts: number[] = [];
  const mock = mockFetch(async () => {
    starts.push(Date.now());
    return new Response("User-agent: *\n");
  });
  try {
    const first = fetcher(30);
    const second = fetcher(30);
    await first.assertAllowed("https://warm.invalid/a");
    await Promise.all([
      first.assertAllowed("https://one.invalid/a"), first.assertAllowed("https://two.invalid/a"),
      second.assertAllowed("https://three.invalid/a"),
    ]);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(30);
  } finally { mock.mockRestore(); }
});

describe("robots groups and specificity", () => {
  test("consecutive user-agent headers share their rules", async () => {
    await withRobots("User-agent: *\nUser-agent: unrelated\nDisallow: /", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
    });
  });
  test("combines all wildcard groups, including groups separated by an empty rule", async () => {
    await withRobots("User-agent: *\nDisallow: /private\nUser-agent: *\nDisallow:\nUser-agent: *\nDisallow: /secret", async (client) => {
      for (const route of ["/private/file.pdf", "/secret/file.pdf"]) {
        await expect(client.assertAllowed(`https://example.invalid${route}`)).rejects.toBeInstanceOf(DisallowedByRobots);
      }
      await expect(client.assertAllowed("https://example.invalid/public.pdf")).resolves.toBeUndefined();
    });
  });
  test("combines matching product groups and uses wildcard only as fallback", async () => {
    await withRobots("User-agent: *\nDisallow: /\nUser-agent: UNTangle-syllabus-study\nDisallow: /private\nUser-agent: UNTangle-syllabus-study\nDisallow: /secret", async (client) => {
      for (const route of ["/private/file.pdf", "/secret/file.pdf"]) {
        await expect(client.assertAllowed(`https://example.invalid${route}`)).rejects.toBeInstanceOf(DisallowedByRobots);
      }
      await expect(client.assertAllowed("https://example.invalid/public.pdf")).resolves.toBeUndefined();
    });
  });
  test("wildcard-only disallow blocks unless an allow rule actually matches", async () => {
    await withRobots("User-agent: *\nDisallow: *", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
    });
    await withRobots("User-agent: *\nDisallow: *\nAllow: /public", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/private")).rejects.toBeInstanceOf(DisallowedByRobots);
      await expect(client.assertAllowed("https://example.invalid/public/file.pdf")).resolves.toBeUndefined();
    });
    await withRobots("User-agent: *\nDisallow: *\nAllow: *", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/file.pdf")).resolves.toBeUndefined();
    });
  });
  test("wildcard expansion does not outrank a literal disallow", async () => {
    await withRobots("User-agent: *\nAllow: /*\nDisallow: /private", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/private/long/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
      await expect(client.assertAllowed("https://example.invalid/public.pdf")).resolves.toBeUndefined();
    });
  });
  test("canonicalizes unreserved URI octets in both paths and rules", async () => {
    await withRobots("User-agent: *\nDisallow: /foo/bar/baz\nDisallow: /%70rivate\nDisallow: /caf%C3%A9\nDisallow: /%F0%9F%93%9A", async (client) => {
      for (const route of ["/foo/bar/%62%61%7A", "/foo/bar/%62%61%7a", "/private/file.pdf", "/caf%c3%a9", "/café", "/📚"]) {
        await expect(client.assertAllowed(`https://example.invalid${route}`)).rejects.toBeInstanceOf(DisallowedByRobots);
      }
    });
  });
  test("encoded separators stay distinct and encoded literals count as one octet", async () => {
    await withRobots("User-agent: *\nDisallow: /foo/bar\nDisallow: /foo%2fbar\nAllow: /foo%2Fbar/public\nDisallow: /encoded/%62%61%7A\nAllow: /encoded/baz", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/foo%2Fbar/private")).rejects.toBeInstanceOf(DisallowedByRobots);
      await expect(client.assertAllowed("https://example.invalid/foo%2Fbar/public")).resolves.toBeUndefined();
      await expect(client.assertAllowed("https://example.invalid/encoded/baz")).resolves.toBeUndefined();
    });
    await withRobots("User-agent: *\nDisallow: /foo/bar", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/foo%2Fbar")).resolves.toBeUndefined();
    });
  });
  test("specific allow, equal-length allow, and anchored rules retain their semantics", async () => {
    await withRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /equal\nAllow: /equal\nDisallow: /*.pdf$", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/private/public.txt")).resolves.toBeUndefined();
      await expect(client.assertAllowed("https://example.invalid/equal")).resolves.toBeUndefined();
      await expect(client.assertAllowed("https://example.invalid/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
      await expect(client.assertAllowed("https://example.invalid/file.pdf.txt")).resolves.toBeUndefined();
    });
  });
});
