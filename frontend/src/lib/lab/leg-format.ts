import type { DayLegSummary, LabLeg } from "@/lib/lab/leg-routing";

export function formatMeters(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatWalkingMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min walk`;
}

/** The longest gap the student must cross, walking or approximate. */
export function pickLongestLeg(legs: LabLeg[]): LabLeg | null {
  let longest: LabLeg | null = null;
  legs.forEach((leg) => {
    if (leg.status === "walking" || leg.status === "approximate") {
      if (!longest || leg.distanceMeters > longest.distanceMeters) {
        longest = leg;
      }
    }
  });
  return longest;
}

export function dayLegNotice(summary: DayLegSummary): string | null {
  if (summary.approximateLegs === 0) return null;
  return summary.approximateLegs === 1
    ? "One leg is a straight-line estimate — the routing service could not provide a walking path."
    : `${summary.approximateLegs} legs are straight-line estimates — the routing service could not provide walking paths.`;
}
