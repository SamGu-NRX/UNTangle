import type { PlannerSaveStatus } from "@/components/planner-provider";

/** The schedule pill's dot: accent when saved, ink-4 while saving, danger on trouble. */
export type ChipTone = "saved" | "saving" | "error";

export function chipTone(status: PlannerSaveStatus): ChipTone {
  switch (status) {
    case "saved":
      return "saved";
    case "saving":
    case "pending":
      return "saving";
    case "not-saved":
    case "failed":
    case "signed-out":
      return "error";
  }
}

/**
 * Short state for the pill. The provider's trouble labels end in "…" to
 * hint at more detail; the schedule sheet shows that detail, so the pill
 * drops it. "Saving…" keeps its ellipsis, which there means work in progress.
 */
export function chipStatusLabel(status: PlannerSaveStatus, label: string): string {
  return status !== "saving" && label.endsWith("…") ? label.slice(0, -1) : label;
}

/** Named schedules arrive with the library rebuild; until then every plan is the one schedule, "Main". */
export const SCHEDULE_NAME = "Main";
