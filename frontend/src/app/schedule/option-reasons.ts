/**
 * Week's Details lines for an alternative, from scheduleReasons: seat
 * warnings, then up to three facts about the option on the student's own
 * preferences, strongest first. No comparison with the next option: Details
 * already sets the option beside the student's week, and the next option is
 * one they may not have seen ("80 minutes longer than in option 2" named a
 * drawback as a reason, against a week off screen). Kept beside the UNTangle
 * host so the schedule builder itself never reads lib/reasons.
 */
import type { OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import { scheduleReasons } from "@/lib/reasons";
import { optionName } from "@/components/schedule-builder/week";
import type { Section } from "@/lib/sections";

export function optionReasons(input: {
  alternatives: readonly RankedSchedule[];
  index: number;
  /** The exact request these alternatives came from, walking time included. */
  request: OptimizeRequest;
  seats: Readonly<Record<string, Pick<Section, "status" | "components">>>;
}): Array<{ sentence: string; warning: boolean }> {
  return scheduleReasons({ ...input, optionName, compareWithNext: false }).map((reason) => ({ sentence: reason.sentence, warning: reason.kind === "seats" }));
}
