/**
 * Offline schedule snapshot — persists the last known schedule for the PWA
 * so /today still shows classes when the network is gone. Read paths
 * validate the FULL stored shape (every ScheduleEvent field, well-formed
 * times, weekday keys) and never trust a partial or corrupted payload:
 * anything that fails validation is discarded and reported as absent,
 * never partially applied.
 */
import { weekDays, type ScheduleEvent, type WeekDay } from "@/lib/types";
import { parseTimeToMinutes } from "@/components/today/today-engine";

const STORAGE_KEY = "untangle.schedule.snapshot.v1";

export type ScheduleSnapshot = {
  savedAt: number;
  events: ScheduleEvent[];
};

function isValidEvent(value: unknown): value is ScheduleEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  return (
    typeof e.sectionId === "string" &&
    e.sectionId.length > 0 &&
    typeof e.courseCode === "string" &&
    typeof e.title === "string" &&
    typeof e.professor === "string" &&
    typeof e.rating === "number" &&
    Number.isFinite(e.rating) &&
    typeof e.location === "string" &&
    typeof e.buildingId === "string" &&
    typeof e.day === "string" &&
    (weekDays as string[]).includes(e.day) &&
    typeof e.start === "string" &&
    timeRe.test(e.start) &&
    typeof e.end === "string" &&
    timeRe.test(e.end) &&
    parseTimeToMinutes(e.start) < parseTimeToMinutes(e.end)
  );
}

function parseSnapshot(raw: string): ScheduleSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as { savedAt?: unknown; events?: unknown };
    if (typeof candidate.savedAt !== "number" || !Number.isFinite(candidate.savedAt)) {
      return null;
    }
    if (!Array.isArray(candidate.events)) {
      return null;
    }
    for (const event of candidate.events) {
      if (!isValidEvent(event)) {
        return null;
      }
    }
    return { savedAt: candidate.savedAt, events: candidate.events as ScheduleEvent[] };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Last saved snapshot, or null when absent/invalid. Never throws. */
export function loadScheduleSnapshot(): ScheduleSnapshot | null {
  const store = storage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? parseSnapshot(raw) : null;
  } catch {
    return null;
  }
}

/** Persist events; invalid events abort the save so the cache stays trustworthy. */
export function saveScheduleSnapshot(events: ScheduleEvent[]): boolean {
  const store = storage();
  if (!store) {
    return false;
  }
  for (const event of events) {
    if (!isValidEvent(event)) {
      return false;
    }
  }
  const snapshot: ScheduleSnapshot = { savedAt: Date.now(), events };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearScheduleSnapshotForTests(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

/** "saved 14:32" for the offline banner. */
export function formatSnapshotTime(savedAt: number): string {
  const d = new Date(savedAt);
  return `saved ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Events grouped by weekday for the week-ahead strip. */
export function eventsByDay(events: ScheduleEvent[]): Partial<Record<WeekDay, ScheduleEvent[]>> {
  const grouped: Partial<Record<WeekDay, ScheduleEvent[]>> = {};
  for (const event of events) {
    (grouped[event.day] ??= []).push(event);
  }
  return grouped;
}
