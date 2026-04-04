import Link from "next/link";
import type { ReactNode } from "react";
import { StepBar } from "@/components/ui/StepBar";

export function AuthShell({
  step = 0,
  totalSteps = 4,
  children,
}: {
  step?: number;
  totalSteps?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <main
        className="animate-content-enter"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
        }}
      >
        <div className="surface-card" style={{ width: "100%", maxWidth: 420, padding: "1.75rem 1.6rem" }}>
          <div style={{ marginBottom: 18 }}>
            <Link
              href="/"
              className="font-display"
              style={{
                fontSize: "1.6rem",
                fontWeight: 800,
                color: "var(--brand-900)",
                letterSpacing: "-0.04em",
              }}
            >
              UNTangle
            </Link>
            <div style={{ marginTop: 12 }}>
              <StepBar total={totalSteps} current={step} />
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
