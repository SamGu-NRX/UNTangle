export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "gold" | "stone";
}) {
  const className =
    tone === "green"
      ? "border-[rgba(79,127,95,0.22)] bg-[color:var(--green-100)] text-[color:var(--green-800)]"
      : tone === "gold"
        ? "border-[rgba(181,139,55,0.24)] bg-[color:var(--gold-100)] text-[color:var(--gold-500)]"
        : "border-[color:var(--line)] bg-[rgba(255,255,255,0.72)] text-[color:var(--muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.16em] uppercase ${className}`}
    >
      {label}
    </span>
  );
}
