import { formatGpa, gpaTone } from "@/lib/grades";

export function GpaBadge({ gpa, label = "GPA" }: { gpa: number | null; label?: string }) {
  return (
    <span className="gpa-badge" data-tone={gpaTone(gpa)}>
      <span>{label}</span>
      <strong>{formatGpa(gpa)}</strong>
    </span>
  );
}
