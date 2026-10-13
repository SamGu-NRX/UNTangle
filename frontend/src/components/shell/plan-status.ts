import type { PlannerSaveStatus } from "@/components/planner-provider";

/** The PlanChip dot: accent when saved, ink-4 while saving, danger on trouble. */
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
 * The plan has no user-chosen name yet (PlannerState carries none), so the
 * chip names whose plan it is rather than inventing a title.
 */
export function planName(isRegistered: boolean): string {
  return isRegistered ? "My plan" : "Guest plan";
}

/**
 * Short state for the chip. The provider's trouble labels end in "…" to
 * hint at more detail; the chip's menu shows that detail, so the chip drops
 * it. "Saving…" keeps its ellipsis, which there means work in progress.
 */
export function chipStatusLabel(status: PlannerSaveStatus, label: string): string {
  return status !== "saving" && label.endsWith("…") ? label.slice(0, -1) : label;
}
