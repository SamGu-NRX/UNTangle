/**
 * Fits events into the gaps between a day's classes. An event fits between
 * two consecutive classes when it starts at or after the earlier class ends,
 * ends at or before the later class starts, and leaves enough time for the
 * walks on both sides when both endpoint buildings are known. An unknown
 * building means no walking requirement at all, never a guessed 0.
 */

import { getWalkingSeconds, type WalkingTimeFn } from "@/lib/campus/walking-times";
import type { DayClass, EventGapPlacement, NormalizedEvent } from "./types";

/** The events that fit the day's gaps, sorted by start; a class-less day fits nothing. */
export function eventsInGaps(
  daySchedule: readonly DayClass[],
  events: readonly NormalizedEvent[],
  walkingTime: WalkingTimeFn = getWalkingSeconds,
): EventGapPlacement[] {
  const classes = daySchedule
    .map(meeting => ({ startMs: Date.parse(meeting.start), endMs: Date.parse(meeting.end), buildingId: meeting.buildingId }))
    .filter(meeting => Number.isFinite(meeting.startMs) && Number.isFinite(meeting.endMs) && meeting.endMs > meeting.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  // Merge overlapping and back-to-back classes into busy blocks before
  // computing gaps: otherwise an overlapping pair leaves a false gap between
  // the later pair of classes (a class that is still running gets skipped
  // over). A block ends when its latest-ending class ends, so the walk out
  // of the block starts from that class's building; the walk into the next
  // block arrives at its earliest-starting class's building.
  const blocks: Array<{ startMs: number; endMs: number; startBuildingId: string | null; endBuildingId: string | null }> = [];
  for (const meeting of classes) {
    const last = blocks[blocks.length - 1];
    if (last === undefined || meeting.startMs > last.endMs) {
      blocks.push({
        startMs: meeting.startMs,
        endMs: meeting.endMs,
        startBuildingId: meeting.buildingId,
        endBuildingId: meeting.buildingId,
      });
    } else if (meeting.endMs > last.endMs) {
      last.endMs = meeting.endMs;
      last.endBuildingId = meeting.buildingId;
    }
  }

  const placements: EventGapPlacement[] = [];
  for (const event of events) {
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    for (let i = 0; i < blocks.length - 1; i += 1) {
      const before = blocks[i] as { startMs: number; endMs: number; startBuildingId: string | null; endBuildingId: string | null };
      const after = blocks[i + 1] as { startMs: number; endMs: number; startBuildingId: string | null; endBuildingId: string | null };
      if (startMs < before.endMs || endMs > after.startMs) continue;
      const walkTo = before.endBuildingId !== null && event.buildingId !== null
        ? walkingTime(before.endBuildingId, event.buildingId)
        : { seconds: null, source: "unknown" as const };
      const walkFrom = event.buildingId !== null && after.startBuildingId !== null
        ? walkingTime(event.buildingId, after.startBuildingId)
        : { seconds: null, source: "unknown" as const };
      const walkToSeconds = walkTo.seconds;
      const walkFromSeconds = walkFrom.seconds;
      if (walkToSeconds !== null && startMs - before.endMs < walkToSeconds * 1000) continue;
      if (walkFromSeconds !== null && after.startMs - endMs < walkFromSeconds * 1000) continue;
      placements.push({
        event,
        gapStart: new Date(before.endMs).toISOString(),
        gapEnd: new Date(after.startMs).toISOString(),
        walkToSeconds,
        walkFromSeconds,
      });
      break; // one event can occupy one gap; the earliest fitting gap wins
    }
  }
  placements.sort((a, b) => a.event.start.localeCompare(b.event.start));
  return placements;
}
