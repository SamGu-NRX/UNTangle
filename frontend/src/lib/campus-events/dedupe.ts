/**
 * Cross-source deduplication. Two events are the same when their normalized
 * titles match, their starts are within five minutes of each other, and
 * their places match: the same building when both resolved to one, otherwise
 * the same normalized location text. The all-events feed and the group
 * feeds overlap heavily, so the same event often arrives from two sources.
 */

import type { NormalizedEvent } from "./types";

/** Two occurrences of one event may start this far apart, in milliseconds. */
export const DEDUPE_START_WINDOW_MS = 5 * 60 * 1000;

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeEventTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same place means the same building when both have one, else the same normalized text. */
export function placeKey(event: NormalizedEvent): string {
  if (event.buildingId !== null) return `b:${event.buildingId}`;
  return `t:${event.location.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function eventKey(event: NormalizedEvent): string {
  return `${normalizeEventTitle(event.title)}\n${placeKey(event)}`;
}

/** Prefers the representative: one with a URL, then more tags, then earlier source id. */
function preferCandidate(a: NormalizedEvent, b: NormalizedEvent): number {
  const aUrl = a.url === null ? 1 : 0;
  const bUrl = b.url === null ? 1 : 0;
  if (aUrl !== bUrl) return aUrl - bUrl;
  if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length;
  return a.sourceId.localeCompare(b.sourceId);
}

function unionTags(events: readonly NormalizedEvent[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const event of events) {
    for (const tag of event.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Deduplicates across sources. The representative keeps its own start, end,
 * title, url, and location; tags are the union across duplicates, first
 * source's order first. Input order is otherwise preserved.
 */
export function dedupeEvents(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  // Clusters of events sharing a title-and-place key, each cluster holding
  // events whose starts are within the window of the cluster's earliest start.
  const byKey = new Map<string, NormalizedEvent[][]>();
  for (const event of events) {
    const key = eventKey(event);
    let clusters = byKey.get(key);
    if (clusters === undefined) {
      clusters = [];
      byKey.set(key, clusters);
    }
    const startMs = Date.parse(event.start);
    const open = clusters.find(cluster => Math.abs(startMs - Date.parse(cluster[0]!.start)) <= DEDUPE_START_WINDOW_MS);
    if (open !== undefined) {
      open.push(event);
    } else {
      clusters.push([event]);
    }
  }

  const result: NormalizedEvent[] = [];
  const emitted = new Set<NormalizedEvent>();
  for (const event of events) {
    if (emitted.has(event)) continue;
    const cluster = (byKey.get(eventKey(event)) ?? []).find(group => group.includes(event));
    if (cluster === undefined) {
      result.push(event);
      emitted.add(event);
      continue;
    }
    const representative = [...cluster].sort(preferCandidate)[0] as NormalizedEvent;
    result.push({ ...representative, tags: unionTags(cluster) });
    for (const member of cluster) emitted.add(member);
  }
  return result;
}
