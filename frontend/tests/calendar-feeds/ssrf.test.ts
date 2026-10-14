import { expect, test } from "bun:test";
import { CalendarFetchError } from "@/lib/calendar-feeds/errors";
import { defaultFetchDeps, fetchCalendarIcs, type FetchDeps } from "@/lib/calendar-feeds/fetch";
import { httpsFixture } from "./https-fixture";
import { isBlockedAddress, validateCalendarUrl } from "@/lib/calendar-feeds/ssrf";

const ICS_BODY = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

function stubDeps(overrides: Partial<FetchDeps> = {}): { deps: FetchDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: FetchDeps = {
    requestHttps: httpsFixture(() => new Response(ICS_BODY)),
    resolveDns: async (hostname) => {
      calls.push(`dns:${hostname}`);
      return [{ address: "93.184.216.34", family: 4 }];
    },
    doFetch: async (url) => {
      calls.push(`fetch:${url}`);
      return new Response(ICS_BODY, { status: 200, headers: { "content-type": "text/calendar" } });
    },
    timeoutMs: 1000,
    maxBytes: 1024 * 1024,
    maxRedirects: 3,
    ...overrides,
  };
  return { deps, calls };
}

test("the HTTPS transport retains content checks, byte caps, stream errors and the shared deadline", async () => {
  const cases: Array<{ kind: CalendarFetchError["kind"]; body: () => Response }> = [
    { kind: "invalid", body: () => response(200, { "content-type": "text/html" }, "html") },
    { kind: "invalid", body: () => response(200, { "content-type": "text/calendar", "content-length": "2048" }, ICS_BODY) },
    { kind: "invalid", body: () => response(200, { "content-type": "text/calendar" }, "A".repeat(2048)) },
    { kind: "unreachable", body: () => response(200, { "content-type": "text/calendar" }, new ReadableStream({
      start(controller) { controller.error(new Error("connection dropped")); },
    })) },
    { kind: "timeout", body: () => response(200, { "content-type": "text/calendar" }, new ReadableStream({
      pull: () => new Promise(() => {}),
    })) },
  ];
  for (const { kind, body } of cases) {
    const { deps } = stubDeps({
      doFetch: defaultFetchDeps.doFetch,
      requestHttps: httpsFixture(body),
      maxBytes: 1024,
      timeoutMs: 50,
    });
    await expectFetchError(kind, fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  }
});

test("the HTTPS connection is pinned when a second system lookup would rebind to loopback", async () => {
  const connected: string[] = [];
  let systemLookups = 0;
  const requestHttps = httpsFixture(
    () => response(200, { "content-type": "text/calendar" }, ICS_BODY),
    (address) => connected.push(address),
    () => { systemLookups += 1; return "127.0.0.1"; },
  );
  const { deps } = stubDeps({
    doFetch: defaultFetchDeps.doFetch,
    requestHttps: (url, options, onResponse) => {
      expect(options.servername).toBe("calendar.example.com");
      expect(options.headers).toEqual({ Host: "calendar.example.com" });
      expect(options.rejectUnauthorized).toBe(true);
      expect(options.agent).toBe(false);
      return requestHttps(url, options, onResponse);
    },
  });
  await expect(fetchCalendarIcs("https://calendar.example.com/feed.ics", deps)).resolves.toBe(ICS_BODY);
  expect(connected).toEqual(["93.184.216.34"]);
  expect(systemLookups).toBe(0);
});

test("a redirect hostname resolving private is refused before a second connection", async () => {
  const connected: string[] = [];
  const hosts: string[] = [];
  const { deps } = stubDeps({
    resolveDns: async (hostname) => {
      hosts.push(hostname);
      return [{ address: hostname === "calendar.example.com" ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    },
    doFetch: defaultFetchDeps.doFetch,
    requestHttps: httpsFixture(
      () => response(302, { location: "https://rebound.example.com/feed.ics" }),
      (address) => connected.push(address),
    ),
  });
  await expectFetchError("blocked", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(hosts).toEqual(["calendar.example.com", "rebound.example.com"]);
  expect(connected).toEqual(["93.184.216.34"]);
});

function response(status: number, headers: Record<string, string>, body: BodyInit | null = null): Response {
  return new Response(body, { status, headers });
}

function expectFetchError(kind: CalendarFetchError["kind"], promise: Promise<string>) {
  return expect(promise).rejects.toMatchObject({ kind, name: "CalendarFetchError" });
}

test("isBlockedAddress blocks every reserved IPv4 class", () => {
  const blocked = [
    "0.0.0.0",
    "0.1.2.3",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.9",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.5",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ];
  for (const ip of blocked) expect(isBlockedAddress(ip)).toBe(true);
});

test("isBlockedAddress blocks loopback, local, multicast, documentation, and embedded IPv4 in IPv6", () => {
  const blocked = [
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::5",
    "::ffff:10.0.0.5",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:0001",
    "64:ff9b::a00:1",
    "fe80::1%eth0",
    "2002:7f00:0001::",
  ];
  for (const ip of blocked) expect(isBlockedAddress(ip)).toBe(true);
});

test("isBlockedAddress allows only global unicast IPv6, minus its special-purpose ranges", () => {
  const blocked = [
    "fec0::1", // deprecated site-local, which the old blocklist let through
    "feff:ffff::1", // top of fec0::/10
    "fd12:3456::1", // unique local
    "100::1", // discard-only
    "4000::1", // outside 2000::/3
    "1fff:ffff::1", // just below 2000::/3
    "2001::1", // Teredo
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo, full form
    "2001:2::1", // benchmarking, inside 2001::/23
    "2001:1ff:ffff::1", // top of 2001::/23
    "2001:db8:1::1", // documentation
    "2002:808:808::1", // 6to4 wrapping a public IPv4 is still blocked
    "3fff::1", // documentation, RFC 9637
    "64:ff9b:1::808:808", // local-use NAT64 is outside 2000::/3
    "::ffff:0:808:808", // IPv4-translated form is outside 2000::/3
    "::10.0.0.1", // IPv4-compatible, private
    "64:ff9b::169.254.169.254", // NAT64 to the metadata address
  ];
  for (const ip of blocked) expect([ip, isBlockedAddress(ip)]).toEqual([ip, true]);
  const allowed = [
    "2606:4700::1111",
    "2a00:1450:4001::200e",
    "2001:200::1", // first address past 2001::/23
    "3ffe::1", // inside 2000::/3, outside 3fff::/20
    "::ffff:8.8.8.8", // IPv4-mapped, public
    "::8.8.8.8", // IPv4-compatible, public
    "64:ff9b::808:808", // NAT64, public
  ];
  for (const ip of allowed) expect([ip, isBlockedAddress(ip)]).toEqual([ip, false]);
});

test("isBlockedAddress allows public addresses and fails closed on garbage", () => {
  expect(isBlockedAddress("8.8.8.8")).toBe(false);
  expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  expect(isBlockedAddress("2606:4700:0:0:0:0:0:1111")).toBe(false);
  expect(isBlockedAddress("not an address")).toBe(true);
  expect(isBlockedAddress("999.1.2.3")).toBe(true);
});

test("validateCalendarUrl enforces https, no credentials, length cap, and local hostnames", () => {
  expect(validateCalendarUrl("http://calendar.example.com/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("ftp://calendar.example.com/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://user:pass@example.com/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl(`https://example.com/${"x".repeat(2048)}`).ok).toBe(false);
  expect(validateCalendarUrl("https://LOCALHOST/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://api.localhost/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://service.internal/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://printer.local/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://127.0.0.1/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://[::1]/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://169.254.169.254/feed.ics").ok).toBe(false);
  expect(validateCalendarUrl("https://[fe80::1]/feed.ics").ok).toBe(false);
  // A well-formed public https URL passes.
  expect(validateCalendarUrl("https://calendar.example.com/feed.ics").ok).toBe(true);
  // No credentials on any shape of the URL.
  expect(validateCalendarUrl("https://token@example.com/feed.ics").ok).toBe(false);
});

test("a URL longer than 2048 characters is rejected", () => {
  expect(validateCalendarUrl("https://example.com/feed.ics").ok).toBe(true);
  const tooLong = `https://example.com/${"x".repeat(2048)}.ics`;
  expect(tooLong.length).toBeGreaterThanOrEqual(2048);
  expect(validateCalendarUrl(tooLong).ok).toBe(false);
});

test("DNS resolving to a private address is rejected before any fetch happens", async () => {
  const { deps, calls } = stubDeps({
    resolveDns: async () => [{ address: "10.1.2.3", family: 4 }],
  });
  await expectFetchError("blocked", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(calls.every((call) => call.startsWith("dns:"))).toBe(true);
  expect(calls.some((call) => call.startsWith("fetch:"))).toBe(false);
});

test("DNS failing is a closed door: rejection, not a fetch", async () => {
  const { deps, calls } = stubDeps({
    resolveDns: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  await expectFetchError("unreachable", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(calls.some((call) => call.startsWith("fetch:"))).toBe(false);
});

test("an empty DNS answer is also a rejection", async () => {
  const { deps } = stubDeps({ resolveDns: async () => [] });
  await expectFetchError("unreachable", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a blocked address among several resolved addresses is rejected", async () => {
  const { deps } = stubDeps({
    resolveDns: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ],
  });
  await expectFetchError("blocked", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a redirect to a private IP is rejected at the hop", async () => {
  const { deps, calls } = stubDeps();
  deps.doFetch = async (url) => {
    calls.push(`fetch:${url}`);
    return response(302, { location: "https://10.0.0.5/feed.ics" });
  };
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(calls.filter((call) => call.startsWith("fetch:"))).toHaveLength(1); // only the first hop
});

test("a redirect to http is rejected", async () => {
  const { deps } = stubDeps({
    doFetch: async () => response(302, { location: "http://calendar.example.com/feed.ics" }),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a fourth redirect is an error after three allowed hops", async () => {
  let hops = 0;
  const { deps } = stubDeps({
    doFetch: async () => {
      hops += 1;
      return response(302, { location: `https://hop${hops}.example.com/feed.ics` });
    },
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(hops).toBe(4); // three redirects followed, the fourth is refused
});

test("a 3xx without a usable Location is an error", async () => {
  const { deps } = stubDeps({ doFetch: async () => response(302, {}) });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a valid single redirect chain succeeds when every hop is public", async () => {
  const { deps, calls } = stubDeps();
  deps.doFetch = async (url) => {
    calls.push(`fetch:${url}`);
    return url === "https://calendar.example.com/feed.ics"
      ? response(302, { location: "https://cdn.example.com/feed.ics" })
      : new Response(ICS_BODY, { status: 200, headers: { "content-type": "text/calendar" } });
  };
  await expect(fetchCalendarIcs("https://calendar.example.com/feed.ics", deps)).resolves.toBe(ICS_BODY);
  expect(calls).toEqual([
    "dns:calendar.example.com",
    "fetch:https://calendar.example.com/feed.ics",
    "dns:cdn.example.com",
    "fetch:https://cdn.example.com/feed.ics",
  ]);
});

test("a Content-Length over the cap is rejected before reading", async () => {
  const { deps } = stubDeps({
    doFetch: async () =>
      response(200, { "content-type": "text/calendar", "content-length": String(1024 * 1024 + 1) }, ICS_BODY),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a streamed body larger than the cap is rejected even with no Content-Length", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(65); // 64 KiB of "A"
  const { deps } = stubDeps({
    maxBytes: 1024 * 1024,
    doFetch: async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/calendar" } });
    },
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("an html content type is rejected", async () => {
  const { deps } = stubDeps({
    doFetch: async () => response(200, { "content-type": "text/html; charset=utf-8" }, "<html></html>"),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a body that does not start with BEGIN:VCALENDAR is rejected", async () => {
  const { deps } = stubDeps({
    doFetch: async () => response(200, { "content-type": "text/calendar" }, "BEGIN:VCARD\r\nEND:VCARD\r\n"),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a leading byte-order mark or whitespace before BEGIN:VCALENDAR is tolerated", async () => {
  const { deps } = stubDeps({
    doFetch: async () => response(200, { "content-type": "application/ics" }, `  \uFEFF${ICS_BODY}`),
  });
  await expect(fetchCalendarIcs("https://calendar.example.com/feed.ics", deps)).resolves.toContain("VCALENDAR");
});

test("a text/calendar happy path returns the raw text", async () => {
  const { deps } = stubDeps();
  await expect(fetchCalendarIcs("https://calendar.example.com/feed.ics", deps)).resolves.toBe(ICS_BODY);
});

test("an application/octet-stream body that is a valid calendar is accepted", async () => {
  const { deps } = stubDeps({
    doFetch: async () => new Response(ICS_BODY, { status: 200, headers: { "content-type": "application/octet-stream" } }),
  });
  await expect(fetchCalendarIcs("https://calendar.example.com/feed.ics", deps)).resolves.toBe(ICS_BODY);
});

test("a never-settling doFetch honoring the abort signal rejects as a timeout", async () => {
  const { deps } = stubDeps({
    timeoutMs: 50,
    doFetch: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  await expectFetchError("timeout", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a hanging body stream also hits the shared deadline", async () => {
  const { deps } = stubDeps({
    timeoutMs: 50,
    doFetch: async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull: () => new Promise(() => {}), // never settles
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/calendar" } });
    },
  });
  await expectFetchError("timeout", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a connection dropped mid-read maps to a fetch error, not a raw stream error", async () => {
  const { deps } = stubDeps({
    doFetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("BEGIN:VCALENDAR\r\n"));
            controller.error(new TypeError("connection dropped"));
          },
        }),
        { status: 200, headers: { "content-type": "text/calendar" } },
      ),
  });
  await expectFetchError("unreachable", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
});

test("a body exceeding the size limit mid-stream is canceled", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2048).fill(65));
    },
    cancel() {
      canceled = true;
    },
  });
  const { deps } = stubDeps({
    maxBytes: 1024,
    doFetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/calendar" } }),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(canceled).toBe(true);
});

test("a non-calendar content type response has its body canceled", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html></html>"));
    },
    cancel() {
      canceled = true;
    },
  });
  const { deps } = stubDeps({
    doFetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
  });
  await expectFetchError("invalid", fetchCalendarIcs("https://calendar.example.com/feed.ics", deps));
  expect(canceled).toBe(true);
});

test("a redirect response body is canceled before following the hop", async () => {
  let canceled = false;
  const redirect = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("moved"));
      },
      cancel() {
        canceled = true;
      },
    }),
    { status: 302, headers: { location: "https://calendar.example.com/feed.ics" } },
  );
  let fetchCount = 0;
  const { deps } = stubDeps({
    doFetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) return redirect;
      return new Response(ICS_BODY, { status: 200, headers: { "content-type": "text/calendar" } });
    },
  });
  await expect(fetchCalendarIcs("https://calendar.example.com/redirect", deps)).resolves.toBe(ICS_BODY);
  expect(canceled).toBe(true);
  expect(fetchCount).toBe(2);
});
