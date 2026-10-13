"use client";

import { usePlanner } from "@/components/planner-provider";

/**
 * The bundled sections are synthetic: generated times, rooms and instructors
 * over 15 buildings, with no term. The planner falls back to them when real
 * sections cannot load, and old plans may still hold them. Wherever the plan
 * shows one, say so; with only real sections there is nothing to say.
 */
export function PlannerSampleNotice({ compact = false }: { compact?: boolean }) {
  const { sectionPlan } = usePlanner();
  if (!sectionPlan.courses.some((course) => course.section?.term === null)) return null;
  return (
    <p
      role="status"
      aria-label="Sample data notice"
      data-sample-notice
      style={{
        margin: 0,
        border: "1px dashed var(--line)",
        borderRadius: "var(--r-sm)",
        padding: compact ? "0.45rem 0.65rem" : "0.6rem 0.75rem",
        fontSize: compact ? "0.8rem" : "0.86rem",
        color: "var(--copy)",
        background: "var(--surface)",
      }}
    >
      <strong style={{ color: "var(--ink)" }}>Sample data.</strong> Sections, meeting times, rooms and instructors here
      are synthetic, not UNT&rsquo;s class schedule. Check the official schedule before you register.
    </p>
  );
}

/** Inline tag for a single sample value (a section, a time, an instructor). */
export function SampleTag() {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "0 0.35rem",
        border: "1px solid var(--line)",
        borderRadius: 999,
        fontSize: "0.68rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--copy)",
        verticalAlign: "middle",
      }}
    >
      Sample
    </span>
  );
}
