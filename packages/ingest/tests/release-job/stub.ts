/**
 * A local stub of the VSB mirror, for tests that must never touch a live
 * site. Serves schema v2 files with ETag and Last-Modified conditional
 * support, and records what arrived and how many requests ran at once.
 */

export type StubFile = {
  body: string;
  etag?: string;
  lastModified?: string;
  /** Delay before answering, for timeout and concurrency tests. */
  delayMs?: number;
  status?: number;
};

export type StubMirror = {
  url: string;
  requests: string[];
  /** Highest number of requests served at the same moment. */
  maxInFlight: number;
  setFile(pathname: string, file: StubFile): void;
  stop(): Promise<void>;
};

export function startStubMirror(files: Record<string, StubFile> = {}): StubMirror {
  const served = files;
  const requests: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      requests.push(pathname);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const file = served[pathname];
        if (file?.delayMs) await Bun.sleep(file.delayMs);
        if (!file) return new Response("not found", { status: 404 });
        if (file.status) return new Response("stubbed", { status: file.status });
        const ifNoneMatch = request.headers.get("if-none-match");
        if (file.etag && ifNoneMatch !== null && ifNoneMatch === file.etag) {
          return new Response(null, { status: 304 });
        }
        const ifModifiedSince = request.headers.get("if-modified-since");
        if (file.lastModified && ifModifiedSince !== null && ifModifiedSince === file.lastModified) {
          return new Response(null, { status: 304 });
        }
        const headers = new Headers({ "Content-Type": "application/json" });
        if (file.etag) headers.set("ETag", file.etag);
        if (file.lastModified) headers.set("Last-Modified", file.lastModified);
        return new Response(file.body, { headers });
      } finally {
        inFlight--;
      }
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    requests,
    get maxInFlight() {
      return maxInFlight;
    },
    setFile(pathname, file) {
      served[pathname] = file;
    },
    stop: () => server.stop(true),
  };
}

/** A policy shaped like vsb-untgrades but pointed at the stub, so the URL check still runs. */
export function stubPolicy(url: string): import("../../src/source-policies").ReviewedSourcePolicy {
  return Object.freeze({
    sourceId: "vsb-untgrades",
    institutionId: "unt",
    description: "test stub",
    acquisition: "server" as const,
    approval: "allowed" as const,
    retention: "versioned" as const,
    redistribution: "unverified" as const,
    allowedUrlPrefixes: Object.freeze([`${url}/data/`]),
    minIntervalMs: 0,
    maxRequestsPerHour: null,
    maxConcurrency: 1,
    policyEvidenceUrl: null,
    policyCheckedAt: null,
  });
}
