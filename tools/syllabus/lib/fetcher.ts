/**
 * Polite HTTP fetching for the UNT syllabus study.
 *
 * House rules, in one place:
 * - at most one network request per second, shared across every caller;
 * - robots.txt is fetched per origin and honored (Allow beats Disallow only
 *   when its match is longer, per the robots RFC draft);
 * - every response body is cached on disk under `.cache/http/` keyed by the
 *   SHA-1 of the URL, so a re-run never re-requests a page it already has;
 * - transient failures (5xx, timeouts) are retried at most twice with a
 *   growing pause. Nothing here retries a robots disallow or a 404.
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
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === "user-agent") {
        current = { agents: [value.toLowerCase()], allow: [], disallow: [] };
        groups.push(current);
      } else if (key === "allow" || key === "disallow") {
        current ??= { agents: ["*"], allow: [], disallow: [] };
        if (value) current[key].push(value);
      }
    }
    return new RobotsRules(groups);
  }

  static empty(): RobotsRules {
    return new RobotsRules([{ agents: ["*"], allow: [], disallow: [] }]);
  }

  private applicable(): RobotGroup | null {
    const star = this.groups.filter((g) => g.agents.includes("*"));
    return star.length > 0 ? star[star.length - 1] : null;
  }

  private static regexCache = new Map<string, RegExp>();

  private static matchLength(pattern: string, path: string): number {
    if (!pattern) return 0;
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
    const match = re.exec(path);
    return match ? match[0].length : 0;
  }

  isAllowed(pathname: string): boolean {
    const group = this.applicable();
    if (!group) return true;
    const allow = Math.max(0, ...group.allow.map((p) => RobotsRules.matchLength(p, pathname)));
    const disallow = Math.max(0, ...group.disallow.map((p) => RobotsRules.matchLength(p, pathname)));
    return allow >= disallow;
  }
}

export interface PoliteFetcherOptions {
  cacheDir: string;
  minDelayMs?: number;
  timeoutMs?: number;
}

export class PoliteFetcher {
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly cacheDir: string;
  private readonly robots = new Map<string, RobotsRules>();
  private lastRequestAt = 0;

  constructor(options: PoliteFetcherOptions) {
    this.cacheDir = options.cacheDir;
    this.minDelayMs = options.minDelayMs ?? 1100;
    this.timeoutMs = options.timeoutMs ?? 30000;
    mkdirSync(path.join(this.cacheDir, "http"), { recursive: true });
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minDelayMs - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    this.lastRequestAt = Date.now();
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
    await this.throttle();
    try {
      const res = await fetch(new URL("/robots.txt", origin), {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const rules = res.status === 200 ? RobotsRules.parse(await res.text()) : RobotsRules.empty();
      this.robots.set(origin, rules);
      return rules;
    } catch {
      // An unreachable robots.txt is not permission to give up: the RFC draft
      // default when robots.txt cannot be fetched is full allow.
      const rules = RobotsRules.empty();
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
    const paths = this.cachePaths(url);
    if (existsSync(paths.body) && existsSync(paths.meta)) {
      const meta = JSON.parse(readFileSync(paths.meta, "utf8")) as CacheMeta;
      return { url, status: meta.status, contentType: meta.contentType, body: readFileSync(paths.body), fromCache: true };
    }

    await this.assertAllowed(url);

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await Bun.sleep(2000 * attempt);
      await this.throttle();
      try {
        const res = await fetch(url, {
          redirect: "follow",
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        // 5xx and 429 are transient; 4xx client errors are not.
        if (res.status >= 500 || res.status === 429) {
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
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(`fetch failed after retries: ${url} (${lastError})`);
  }
}
