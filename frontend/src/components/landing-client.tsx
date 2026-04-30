"use client";

import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { StaggerGroup } from "@/components/ui/StaggerGroup";

const features = [
  {
    title: "Mark what you've already taken.",
    copy: "A clean academic intake — search, select, and your prerequisites unlock as you go.",
  },
  {
    title: "Optimize a single semester goal.",
    copy: "Compact days, morning clusters, shorter walks, or stronger professor ratings.",
  },
  {
    title: "Walk the route, not just the grid.",
    copy: "Final step is a real campus path. Print it or take it with you on phone.",
  },
];

export function LandingClient() {
  return (
    <MarketingShell>
      <div style={{ display: "grid", gap: "2rem", justifyItems: "center", textAlign: "center" }}>
        <span className="editorial-label">UNT course planning</span>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(2.6rem, 6vw, 4.6rem)",
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: "-0.04em",
            color: "var(--brand-900)",
            maxWidth: "18ch",
          }}
        >
          Build your schedule without the interface fighting you first.
        </h1>
        <p
          style={{
            fontSize: "1.05rem",
            lineHeight: 1.7,
            color: "var(--copy)",
            maxWidth: 640,
          }}
        >
          UNTangle plans your UNT semester end-to-end: courses, schedule, and a campus walking
          route — all in three calm steps. Browse as a guest, or sign in to keep your plan.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/courses" className="btn-primary">
            Continue as guest
          </Link>
          <Link href="/auth" className="btn-secondary">
            Sign in or create account
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            width: "100%",
            maxWidth: 920,
            marginTop: "2rem",
          }}
        >
          <StaggerGroup step={50}>
            {features.map((f) => (
              <article
                key={f.title}
                className="surface-card"
                style={{ padding: "1.1rem 1.2rem", textAlign: "left" }}
              >
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--brand-900)" }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: "0.85rem", color: "var(--copy)", marginTop: 6, lineHeight: 1.6 }}>
                  {f.copy}
                </p>
              </article>
            ))}
          </StaggerGroup>
        </div>
      </div>
    </MarketingShell>
  );
}
