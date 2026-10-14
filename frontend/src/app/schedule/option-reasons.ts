/**
 * Week's Details lines for an alternative, from PR #55's scheduleReasons:
 * up to three evidence-backed reasons, seat warnings first. Kept beside the
 * UNTangle host so the schedule builder itself never reads lib/reasons.
 */
import type { OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import { scheduleReasons } from "@/lib/reasons";
import type { Section } from "@/lib/sections";

export function optionReasons(input: {
  alternatives: readonly RankedSchedule[];
  index: number;
  /** The exact request these alternatives came from, walking time included. */
  request: OptimizeRequest;
  seats: Readonly<Record<string, Pick<Section, "status" | "components">>>;
}): Array<{ sentence: string; warning: boolean }> {
  return scheduleReasons(input).map((reason) => ({ sentence: reason.sentence, warning: reason.kind === "seats" }));
}
