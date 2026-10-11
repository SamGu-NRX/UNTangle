/**
 * tools/degree-requirements/fetch-lib.mjs
 *
 * Pure helpers for the catalog.unt.edu ingestion fetcher. Kept free of I/O
 * side effects at import time so tests can exercise the robots policy logic
 * directly (see fetch-lib.test.ts).
 */

export const CATALOG_BASE = "https://catalog.unt.edu";

/**
 * Decode fetched bytes to text. Uint8Array.prototype.toString() does NOT
 * accept an encoding (it prints comma-joined decimals), so decoding goes
 * through TextDecoder explicitly.
 */
export function decodeBytes(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * Minimal robots.txt parser: returns the rules of the group that applies to
 * our token (a group naming our token wins; otherwise the last "*" group).
 * Only the directives this tool must obey are kept: Disallow, Allow,
 * Crawl-delay. Handles \r\n line endings and # comments.
 */
export function parseRobots(text, ourToken) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || (current.rules.length && current._closed)) {
        current = { agents: [], rules: [], crawlDelay: null, _closed: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      current._closed = false;
    } else if (current) {
      current._closed = true;
      if (key === "disallow") current.rules.push({ type: "disallow", path: value });
      else if (key === "allow") current.rules.push({ type: "allow", path: value });
      else if (key === "crawl-delay") {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
      }
    }
  }
  const named = groups.filter((g) => g.agents.includes(ourToken));
  const group = named.length
    ? named[named.length - 1]
    : groups.filter((g) => g.agents.includes("*")).slice(-1)[0] ?? null;
  return {
    rules: group ? group.rules : [],
    crawlDelay: group ? group.crawlDelay : null,
  };
}

/** Longest-match allow/disallow verdict for a URL pathname. */
export function robotsVerdict(robots, pathname) {
  let best = null;
  for (const rule of robots.rules) {
    if (rule.path === "" && rule.type === "disallow") continue; // "Disallow:" (empty) = no disallow
    if (pathname.startsWith(rule.path)) {
      if (!best || rule.path.length > best.path.length) best = rule;
    }
  }
  if (best && best.type === "disallow") {
    return { allowed: false, because: `robots.txt disallows ${best.path}` };
  }
  return { allowed: true };
}

/** Effective minimum interval between requests, ms: max(1 rps, crawl-delay). */
export function effectiveIntervalMs(crawlDelaySeconds) {
  return Math.max(1000, (crawlDelaySeconds ?? 0) * 1000);
}
