import Link from "next/link";
import type { ReactNode } from "react";
import { PhaseStepper } from "@/components/ui/PhaseStepper";

export function AuthShell({
  step = 0,
  totalSteps = 4,
  tagline = "Plan UNT semesters.",
  children,
}: {
  step?: number;
  totalSteps?: number;
  tagline?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth-shell animate-content-enter">
      <div className="auth-card">
        <Link href="/" aria-label="UNTangle home">
          <span className="auth-card__brand">
            Un<span className="auth-card__brand-second">Tangle</span>
          </span>
        </Link>
        {tagline ? <p className="auth-card__tagline">{tagline}</p> : null}
        <PhaseStepper current={step} total={totalSteps} />
        {children}
      </div>
    </div>
  );
}
