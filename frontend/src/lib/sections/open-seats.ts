import type { Section } from "./model";

/**
 * Open per INTEGRATION.md: not closed or wait-listed, and every component with
 * known seats has one open. Kept apart from planner-sections, which reads seed
 * data, so the schedule builder's search can apply the same rule.
 */
export function hasOpenSeats(section: Pick<Section, "status" | "components">): boolean {
  if (section.status === "closed" || section.status === "waitlist" || section.status === "cancelled") return false;
  return section.components.every((component) => component.seats.open === null || component.seats.open > 0);
}
