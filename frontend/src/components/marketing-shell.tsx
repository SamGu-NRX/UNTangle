import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <main className="animate-content-enter" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 1.25rem" }}>
        <div style={{ width: "100%", maxWidth: 1100 }}>{children}</div>
      </main>
    </div>
  );
}
