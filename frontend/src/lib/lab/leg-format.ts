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

/** One-line honest description of a leg, used by the itinerary and sheet. */
export function legLine(leg: LabLeg): string {
  if (leg.status === "same-building") {
    return "Same building — no walk needed";
  }
  if (leg.status === "unresolved") {
    return "Location unresolved — no route shown";
  }
  const distance = formatMeters(leg.distanceMeters) + (leg.status === "approximate" ? " (approx.)" : "");
  const time = leg.durationSeconds !== null ? " · " + formatWalkingMinutes(leg.durationSeconds) : " · no walking time";
  const source =
    leg.source === "ors"
      ? "Route © OpenStreetMap contributors via ORS"
      : leg.source === "campus-network"
        ? "Campus walking network"
        : "Straight-line estimate";
  return distance + time + " · " + source;
}
