/**
 * The allowed public UNT event sources, from the verified calendar-feeds
 * directory. calendar.unt.edu is a Modern Campus Localist instance whose
 * robots.txt permits the /calendar.ics export paths with Crawl-Delay: 1
 * (checked 2026-10-15; see docs/research/campus-events.md). Eagle Engage
 * (Anthology Campus Labs) has no public export and robots-disallows /api/,
 * so it is not a source.
 */

import directoryJson from "@/lib/calendar-feeds/directory.json";

/** Architecture's starting interval for directory feeds (the Calendar feeds row). */
export const DEFAULT_SOURCE_INTERVAL_MS = 30 * 60 * 1000;

export type EventSourceDef = {
  /** Stable short id, derived from the feed's URL path. */
  id: string;
  name: string;
  url: string;
  category: string;
  refreshIntervalMs: number;
};

/**
 * Derives a stable source id from a directory feed URL:
 * /calendar.ics -> unt-events-all, /group/<slug>/calendar/ics -> group-<slug>,
 * /department/<slug>/calendar/ics -> department-<slug>.
 */
export function sourceIdForUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "calendar.unt.edu") return null;
  const parts = parsed.pathname.split("/").filter(part => part !== "");
  if (parts.length === 1 && parts[0].endsWith(".ics")) {
    return "unt-events-all";
  }
  const kind = parts[0];
  const slug = parts[1];
  if ((kind === "group" || kind === "department") && slug !== undefined && slug !== "") {
    return `${kind}-${slug}`;
  }
  return null;
}

/** Loads the directory as source definitions, skipping entries without a usable id. */
export function loadEventSources(directory: unknown = directoryJson): EventSourceDef[] {
  if (!Array.isArray(directory)) return [];
  const sources: EventSourceDef[] = [];
  const seen = new Set<string>();
  for (const entry of directory) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { name?: unknown; url?: unknown; category?: unknown };
    if (typeof record.name !== "string" || typeof record.url !== "string") continue;
    const id = sourceIdForUrl(record.url);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    sources.push({
      id,
      name: record.name,
      url: record.url,
      category: typeof record.category === "string" ? record.category : "university-events",
      refreshIntervalMs: DEFAULT_SOURCE_INTERVAL_MS,
    });
  }
  return sources;
}
