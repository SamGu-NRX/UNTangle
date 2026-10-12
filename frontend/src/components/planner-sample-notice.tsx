/**
 * Every section in the bundled data is synthetic: generated sections, times,
 * rooms and instructors over 15 buildings, with no term attached. Anywhere the
 * planner shows them, say so.
 */
export function PlannerSampleNotice({ compact = false }: { compact?: boolean }) {
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
