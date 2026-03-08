export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "gold" | "stone";
}) {
  const className =
    tone === "green"
      ? "border-[#9ad27e] bg-[#f2f8ee] text-[#295928]"
      : tone === "gold"
        ? "border-[#d1b360] bg-[#faf4df] text-[#7a5e12]"
        : "border-[rgba(16,38,20,0.08)] bg-white/75 text-[var(--muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${className}`}
    >
      {label}
    </span>
  );
}
