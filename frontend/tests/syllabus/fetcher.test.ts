import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DisallowedByRobots, PoliteFetcher } from "../../../tools/syllabus/lib/fetcher";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fetcher() {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "syllabus-fetcher-"));
  dirs.push(cacheDir);
  return new PoliteFetcher({ cacheDir, minDelayMs: 0, timeoutMs: 10 });
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
  test("wildcard expansion does not outrank a literal disallow", async () => {
    await withRobots("User-agent: *\nAllow: /*\nDisallow: /private", async (client) => {
      await expect(client.assertAllowed("https://example.invalid/private/long/file.pdf")).rejects.toBeInstanceOf(DisallowedByRobots);
      await expect(client.assertAllowed("https://example.invalid/public.pdf")).resolves.toBeUndefined();
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
