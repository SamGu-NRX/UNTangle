"use client";

import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { planningTerm } from "@/lib/planner-sections";
import type { CourseSections, RealCourseSections } from "@/lib/sections";

/** Where the sections on screen come from, in the terms the tag shows. */
export type SectionsProvenance =
  | { kind: "real"; updatedAt: string; checkedAt: string }
  | { kind: "sample" }
  | { kind: "not-offered" };

/**
 * One label for a set of course results. Any sample on screen (a fallback,
 * or an old plan's synthetic pick) makes the whole set a sample. The data
 * date is the oldest `updatedAt` among the results, so the tag never claims
 * fresher data than some course has.
 */
export function summarizeProvenance(results: readonly CourseSections[], showsSample = false): SectionsProvenance | null {
  if (showsSample || results.some((result) => result.provenance.kind === "sample")) {
    return results.length > 0 || showsSample ? { kind: "sample" } : null;
  }
  const real = results as readonly RealCourseSections[];
  if (real.length === 0) return null;
  if (real.every((result) => result.availability === "no_classes")) return { kind: "not-offered" };
  const oldest = (values: string[]) => values.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  return {
    kind: "real",
    updatedAt: oldest(real.map((result) => result.provenance.updatedAt)),
    checkedAt: oldest(real.map((result) => result.checkedAt)),
  };
}

// UNT's own time zone, so a date reads the same on every machine.
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const moment = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
});

export function provenanceText(provenance: SectionsProvenance, compact = false): string {
  switch (provenance.kind) {
    case "real": {
      const updated = day.format(new Date(provenance.updatedAt));
      return compact ? `Real, updated ${updated}` : `Real ${planningTerm.label} sections, updated ${updated}`;
    }
    case "sample":
      return compact ? "Sample" : "Sample sections";
    case "not-offered":
      return `Not offered in ${planningTerm.label}`;
  }
}

/** The tag's one-sentence explanation. */
export function provenanceSource(provenance: SectionsProvenance): string {
  switch (provenance.kind) {
    case "real":
      return `UNT's ${planningTerm.label} class schedule as published by vsb.untgrades.app, dated ${day.format(new Date(provenance.updatedAt))} and last checked ${moment.format(new Date(provenance.checkedAt))}. Seats change; confirm in myUNT before you register.`;
    case "sample":
      return "Synthetic samples, not UNT's class schedule: times, rooms and instructors are made up.";
    case "not-offered":
      return `UNT's ${planningTerm.label} class schedule, as published by vsb.untgrades.app, lists no classes for this course.`;
  }
}

export function SectionsTag({ provenance, compact = false }: { provenance: SectionsProvenance | null; compact?: boolean }) {
  if (!provenance) return null;
  return <ProvenanceTag source={provenanceSource(provenance)}>{provenanceText(provenance, compact)}</ProvenanceTag>;
}
