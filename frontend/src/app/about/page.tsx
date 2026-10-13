import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = { title: "About" };

const VIEWS = [
  { title: "Courses", copy: "What you've finished, what's open to you next, and what still needs a prerequisite." },
  { title: "Week", copy: "Sections arranged around one goal: compact days, mornings, short walks or rated instructors." },
  { title: "Map", copy: "The walk between classes for each day, stop by stop." },
];

/** Public description of UNTangle, moved here from the old landing page. */
export default function AboutPage() {
  return (
    <MarketingShell>
      <h1>Plan a UNT semester in one place</h1>
      <p>
        UNTangle keeps one plan and shows it three ways. Browse as a guest and your plan stays in this browser; sign in
        with your UNT email to keep it on every device.
      </p>
      <ul className="about-list">
        {VIEWS.map((view) => (
          <li key={view.title}>
            <strong>{view.title}</strong>
            <span>{view.copy}</span>
          </li>
        ))}
      </ul>
      <div className="about-actions">
        <Link href="/courses" className="ui-btn ui-btn--primary">
          Start planning
        </Link>
        <Link href="/auth" className="ui-btn ui-btn--ghost">
          Sign in
        </Link>
      </div>
    </MarketingShell>
  );
}
