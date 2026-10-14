/**
 * Polite HTTP fetching for the UNT syllabus study.
 *
 * House rules, in one place:
 * - at most one network request per second, shared across every caller;
 * - robots.txt is fetched per origin and checked before each resource redirect;
 *   matching uses canonical URI octets and literal rule specificity;
 * - every response body is cached on disk under `.cache/http/` keyed by the
 *   SHA-1 of the URL, so a re-run never re-requests a page it already has;
 * - resource 429 and 5xx responses stop the run by default; retrying them
 *   requires stopOnError: false. Timeouts have at most two retries.
 *   Nothing here retries a robots disallow or a 404.
 *
 * No syllabus content may be committed, so the cache directory is covered by
 * `tools/syllabus/.gitignore`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const USER_AGENT =
  "UNTangle-syllabus-study/1.0 (academic rates study; contact faculty.info@unt.edu documented public syllabi)";

export interface FetchedBody {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  fromCache: boolean;
}

interface CacheMeta {
  url: string;
  status: number;
  contentType: string;
  fetchedAt: string;
}

export class DisallowedByRobots extends Error {
  constructor(readonly url: string) {
    super(`blocked by robots.txt: ${url}`);
  }
}

export class StopOnHttpError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`run stopped: ${url} returned HTTP ${status}`);
  }
}

interface RobotGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

class RobotsRules {
  private constructor(readonly groups: RobotGroup[]) {}

  static parse(text: string): RobotsRules {
    const groups: RobotGroup[] = [];
    let current: RobotGroup | null = null;
    let hasRules = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === "user-agent") {
        if (!current || hasRules) {
          current = { agents: [], allow: [], disallow: [] };
          groups.push(current);
          hasRules = false;
        }
        current.agents.push(value.toLowerCase());
      } else if (key === "allow" || key === "disallow") {
        if (!current) continue;
        hasRules = true;
        if (value) current[key].push(value);
      }
    }
    return new RobotsRules(groups);
  }

  static empty(): RobotsRules {
    return new RobotsRules([{ agents: ["*"], allow: [], disallow: [] }]);
  }

  static blocked(): RobotsRules {
    return new RobotsRules([{ agents: ["*"], allow: [], disallow: ["/"] }]);
  }

  private applicable(): RobotGroup[] {
    const product = USER_AGENT.split("/")[0].toLowerCase();
    const matching = this.groups.filter((group) => group.agents.includes(product));
    return matching.length > 0 ? matching : this.groups.filter((group) => group.agents.includes("*"));
  }

  private static regexCache = new Map<string, RegExp>();

  private static canonicalOctets(value: string): string {
    // Unreserved encoded ASCII equals its literal form. Encoded delimiters
    // remain encoded so %2F cannot become a path separator.
    return value.replace(/%[a-f0-9]{2}|[^\x00-\x7F]/giu, (octet) => {
      if (!octet.startsWith("%")) return encodeURIComponent(octet);
      const decoded = String.fromCharCode(parseInt(octet.slice(1), 16));
      return /^[a-z0-9._~-]$/i.test(decoded) ? decoded : octet.toUpperCase();
    });
  }

  private static matchLength(pattern: string, path: string): number {
    if (!pattern) return 0;
    pattern = RobotsRules.canonicalOctets(pattern);
    path = RobotsRules.canonicalOctets(path);
    // Patterns are matched as regexes ("*" -> ".*"), not as bare prefixes:
    // "/*/media/oembed" must not match "/faculty-profile" just because both
    // start with "/". A pattern ending in "$" is anchored at the end. The
    // regex source is built character by character: Bun's split("*") mangles
    // a leading wildcard ("/*/media".split("*") -> ["/", "/media"]).
    let re = RobotsRules.regexCache.get(pattern);
    if (!re) {
      const anchored = pattern.endsWith("$");
      const body = anchored ? pattern.slice(0, -1) : pattern;
      let source = "";
      for (const ch of body) {
        if (ch === "*") source += ".*";
        else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      re = new RegExp("^" + source + (anchored ? "$" : ""));
      RobotsRules.regexCache.set(pattern, re);
    }
    // Only literal rule bytes contribute specificity, not wildcard expansion.
    return re.test(path) ? Buffer.byteLength(pattern.replace(/\*/g, "").replace(/\$$/, "").replace(/%[A-F0-9]{2}/g, "x"), "utf8") : 0;
  }

  isAllowed(pathname: string): boolean {
    const groups = this.applicable();
    const allow = Math.max(0, ...groups.flatMap((group) => group.allow.map((p) => RobotsRules.matchLength(p, pathname))));
    const disallow = Math.max(0, ...groups.flatMap((group) => group.disallow.map((p) => RobotsRules.matchLength(p, pathname))));
    return allow >= disallow;
  }
}

export interface PoliteFetcherOptions {
  cacheDir: string;
  minDelayMs?: number;
  timeoutMs?: number;
  stopOnError?: boolean;
}

export class PoliteFetcher {
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly cacheDir: string;
  private readonly stopOnError: boolean;
  private stopped: StopOnHttpError | null = null;
  private readonly robots = new Map<string, RobotsRules>();
  private static lastRequestAt = 0;
  private static requestQueue: Promise<void> = Promise.resolve();

  constructor(options: PoliteFetcherOptions) {
    this.cacheDir = options.cacheDir;
    this.minDelayMs = options.minDelayMs ?? 1100;
    this.timeoutMs = options.timeoutMs ?? 30000;
    // A rate-limit or server refusal must stop collection, not trigger more load.
    this.stopOnError = options.stopOnError ?? true;
    mkdirSync(path.join(this.cacheDir, "http"), { recursive: true });
  }

  private send(url: string): Promise<Response> {
    // Start requests inside the global queue, not after releasing a time slot.
    const response = PoliteFetcher.requestQueue.then(async () => {
      const nextRequestAt = PoliteFetcher.lastRequestAt + this.minDelayMs;
      while (Date.now() < nextRequestAt) await Bun.sleep(nextRequestAt - Date.now());
      try {
        return fetch(url, {
          redirect: "manual",
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } finally {
        PoliteFetcher.lastRequestAt = Date.now();
      }
    });
    PoliteFetcher.requestQueue = response.then(() => {}, () => {});
    return response;
  }

  private async request(url: string, checkRobots: boolean): Promise<Response> {
    let current = url;
    // Robots redirects retrieve the policy for the original origin. Resource
    // redirects instead need permission at every destination before requesting it.
    for (let hop = 0; hop <= 5; hop++) {
      if (checkRobots) await this.assertAllowed(current);
      const response = await this.send(current);
      if (checkRobots && this.stopOnError && (response.status === 429 || response.status >= 500)) {
        this.stopped = new StopOnHttpError(current, response.status);
        await response.body?.cancel();
        throw this.stopped;
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error(`redirect missing Location: ${current}`);
      if (hop === 5) throw new Error(`too many redirects: ${url}`);
      const destination = new URL(location, current);
      if (!["http:", "https:"].includes(destination.protocol)) {
        throw new Error(`unsupported redirect protocol: ${destination.protocol}`);
      }
      current = destination.href;
    }
    throw new Error(`too many redirects: ${url}`);
  }

  private cachePaths(url: string): { body: string; meta: string } {
    const key = createHash("sha1").update(url).digest("hex");
    return {
      body: path.join(this.cacheDir, "http", `${key}.body`),
      meta: path.join(this.cacheDir, "http", `${key}.meta.json`),
    };
  }

  private async robotsFor(origin: string): Promise<RobotsRules> {
    const known = this.robots.get(origin);
    if (known) return known;
    try {
      const res = await this.request(new URL("/robots.txt", origin).href, false);
      const rules = res.status >= 200 && res.status < 300
        ? RobotsRules.parse(await res.text())
        : res.status >= 400 && res.status < 500
          ? RobotsRules.empty()
          : RobotsRules.blocked();
      this.robots.set(origin, rules);
      return rules;
    } catch {
      // A timeout or network failure supplies no permission. Keep this origin
      // blocked for the run instead of repeatedly probing an unavailable host.
      const rules = RobotsRules.blocked();
      this.robots.set(origin, rules);
      return rules;
    }
  }

  async assertAllowed(url: string): Promise<void> {
    const parsed = new URL(url);
    const rules = await this.robotsFor(parsed.origin);
    if (!rules.isAllowed(parsed.pathname + parsed.search)) throw new DisallowedByRobots(url);
  }

  /**
   * Fetch a URL politely. Cached responses are returned without touching the
   * network, so repeated study runs stay under the same 1 rps ceiling.
   */
  async fetch(url: string): Promise<FetchedBody> {
    if (this.stopped) throw this.stopped;
    const paths = this.cachePaths(url);
    if (existsSync(paths.body) && existsSync(paths.meta)) {
      const meta = JSON.parse(readFileSync(paths.meta, "utf8")) as CacheMeta;
      return { url, status: meta.status, contentType: meta.contentType, body: readFileSync(paths.body), fromCache: true };
    }

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await Bun.sleep(2000 * attempt);
      try {
        const res = await this.request(url, true);
        // 5xx and 429 are transient; 4xx client errors are not.
        if (res.status >= 500 || res.status === 429) {
          await res.body?.cancel();
          lastError = `HTTP ${res.status}`;
          continue;
        }
        const body = Buffer.from(await res.arrayBuffer());
        const meta: CacheMeta = {
          url,
          status: res.status,
          contentType: res.headers.get("content-type") ?? "application/octet-stream",
          fetchedAt: new Date().toISOString(),
        };
        writeFileSync(paths.body, body);
        writeFileSync(paths.meta, JSON.stringify(meta, null, 2));
        return { url, status: meta.status, contentType: meta.contentType, body, fromCache: false };
      } catch (err) {
        if (err instanceof DisallowedByRobots || err instanceof StopOnHttpError) throw err;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(`fetch failed after retries: ${url} (${lastError})`);
  }
}
