/**
 * Week's preferences as the student sees them: a handful of choices, and one
 * line naming only the ones that differ from the defaults (untangle-v3.md,
 * rule 3). They read and write the optimizer's constraints and weights, so
 * Auto follows exactly what the line says.
 */
import type { BlockedTime, SchedulePreferences, WeekDay } from "@/lib/types";
import { andList, clock, clockWithSuffix } from "./week";

export const WEEKDAYS: readonly WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const PLURAL: Record<WeekDay, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays" };

/** Start after: any time, 9, 10 or 11 AM. */
export const START_AFTER: readonly (number | null)[] = [null, 540, 600, 660];
/** Most credits: no limit, 12, 15 or 18. */
export const MOST_CREDITS: readonly (number | null)[] = [null, 12, 15, 18];

/**
 * "Lunch break" keeps 12:00–1:00 free on weekdays. A starting value with no
 * data behind it; students may want a different hour.
 */
export const LUNCH = { start: 720, end: 780, label: "Lunch" } as const;
const LUNCH_PREFIX = "lunch-";
const isLunch = (block: BlockedTime) => block.id.startsWith(LUNCH_PREFIX);

/** A weight at or above this reads as the preference being on. */
const WEIGHT_ON = 2;
/** The weight a chip sets when switched on. */
const WEIGHT_SET = 4;

export const hasLunch = (p: SchedulePreferences) => WEEKDAYS.every((day) => p.constraints.blocked.some((b) => isLunch(b) && b.day === day));
export const shortWalks = (p: SchedulePreferences) => p.constraints.walkingBufferMinutes !== null;
export const fewerDays = (p: SchedulePreferences) => p.weights.fewerDays >= WEIGHT_ON;
export const topRated = (p: SchedulePreferences) => p.weights.rating >= WEIGHT_ON;

export function withLunch(p: SchedulePreferences, on: boolean): SchedulePreferences {
  const others = p.constraints.blocked.filter((b) => !isLunch(b));
  const lunch = on ? WEEKDAYS.map((day): BlockedTime => ({ id: `${LUNCH_PREFIX}${day}`, label: LUNCH.label, day, start: LUNCH.start, end: LUNCH.end })) : [];
  return { ...p, constraints: { ...p.constraints, blocked: [...others, ...lunch] } };
}

/** Short walks on keeps the default's buffer; off turns the walking check off. */
export function withShortWalks(p: SchedulePreferences, on: boolean, defaults: SchedulePreferences): SchedulePreferences {
  const buffer = on ? (defaults.constraints.walkingBufferMinutes ?? 0) : null;
  return { ...p, constraints: { ...p.constraints, walkingBufferMinutes: buffer } };
}

export const withFewerDays = (p: SchedulePreferences, on: boolean): SchedulePreferences => ({
  ...p,
  weights: { ...p.weights, fewerDays: on ? WEIGHT_SET : 0 },
});
export const withTopRated = (p: SchedulePreferences, on: boolean): SchedulePreferences => ({
  ...p,
  weights: { ...p.weights, rating: on ? WEIGHT_SET : 0 },
});

export type BusyGroup = { label: string; days: WeekDay[]; start: number; end: number; ids: string[] };

/** Busy times as the student entered them: one row per label and time, across its days. Lunch is its own chip. */
export function busyGroups(p: SchedulePreferences): BusyGroup[] {
  const groups = new Map<string, BusyGroup>();
  for (const block of p.constraints.blocked) {
    if (isLunch(block)) continue;
    const key = `${block.label}|${block.start}|${block.end}`;
    const group = groups.get(key) ?? { label: block.label, days: [], start: block.start, end: block.end, ids: [] };
    if (!group.days.includes(block.day)) group.days.push(block.day);
    group.ids.push(block.id);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, days: WEEKDAYS.filter((day) => group.days.includes(day)) }));
}

/** "Work, Tue and Thu 3:00–5:00" */
export const busyLabel = (group: BusyGroup) => `${group.label}, ${andList(group.days)} ${clock(group.start)}–${clock(group.end)}`;

export function addBusy(p: SchedulePreferences, block: Omit<BlockedTime, "id">, id: string): SchedulePreferences {
  return { ...p, constraints: { ...p.constraints, blocked: [...p.constraints.blocked, { ...block, id }] } };
}

export function removeBusy(p: SchedulePreferences, ids: readonly string[]): SchedulePreferences {
  return { ...p, constraints: { ...p.constraints, blocked: p.constraints.blocked.filter((b) => !ids.includes(b.id)) } };
}

/**
 * The Preferences line: only what differs from `defaults`, in plain words,
 * in a fixed order ("Fridays off, nothing before 9 AM, work Tue and Thu
 * 3:00–5:00"). Empty when everything is at its default.
 */
export function preferenceSummary(p: SchedulePreferences, defaults: SchedulePreferences): string {
  const c = p.constraints;
  const parts: string[] = [];
  const off = WEEKDAYS.filter((day) => c.daysOff.includes(day));
  if (off.length > 0) parts.push(`${andList(off.map((day) => PLURAL[day]))} off`);
  if (c.earliestStart !== null && c.earliestStart !== defaults.constraints.earliestStart) parts.push(`nothing before ${clockWithSuffix(c.earliestStart)}`);
  if (c.latestEnd !== null && c.latestEnd !== defaults.constraints.latestEnd) parts.push(`done by ${clockWithSuffix(c.latestEnd)}`);
  if (c.maxCredits !== null && c.maxCredits !== defaults.constraints.maxCredits) parts.push(`${c.maxCredits} credits at most`);
  if (hasLunch(p) && !hasLunch(defaults)) parts.push("a lunch break");
  if (shortWalks(p) !== shortWalks(defaults)) parts.push(shortWalks(p) ? "short walks" : "long walks are fine");
  if (fewerDays(p) && !fewerDays(defaults)) parts.push("fewer days on campus");
  if (topRated(p) && !topRated(defaults)) parts.push("top-rated professors");
  if (c.openSeatsOnly !== defaults.constraints.openSeatsOnly) parts.push(c.openSeatsOnly ? "open seats only" : "full sections allowed");
  if (c.otherSites !== defaults.constraints.otherSites) parts.push(c.otherSites ? "other UNT sites too" : "Denton only");
  for (const group of busyGroups(p)) parts.push(`${group.label.toLowerCase()} ${andList(group.days)} ${clock(group.start)}–${clock(group.end)}`);
  const line = parts.join(", ");
  return line ? line[0].toUpperCase() + line.slice(1) : "";
}
