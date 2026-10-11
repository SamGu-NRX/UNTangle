import type { Metadata } from "next";
import Link from "next/link";
import "../../components/lab/lab.css";

export const metadata: Metadata = {
  title: "UNTangle · Round 1 UX lab",
  description: "Three planner schedule + map directions for round-one comparison.",
};

const DIRECTIONS = [
  {
    href: "/lab/a",
    title: "A — Week grid with integrated day map",
    copy: "The current week schedule, with a live route panel for the selected day beside it.",
  },
  {
    href: "/lab/b",
    title: "B — Day-first itinerary",
    copy: "Classes and walking legs as one timeline, with the map following the selected stop.",
  },
  {
    href: "/lab/c",
    title: "C — Mobile map with bottom sheet",
    copy: "A full-bleed campus map and a draggable bottom sheet for the day's itinerary.",
  },
];

export default function LabIndexPage() {
  return (
    <div className="lab-root">
      <div className="lab-shell">
        <header className="lab-header">
          <h1 className="font-display">Round 1 — UX directions lab</h1>
          <p>
            Three self-contained directions for the planner schedule + map screen. Nothing
            here changes the production pages.
          </p>
        </header>
        <p className="lab-sample" role="status" aria-label="Sample data notice">
          Sample data: every direction runs on synthetic sample sections (15 buildings, no
          real term) — not a real UNT schedule.
        </p>
        <ul className="lab-index">
          {DIRECTIONS.map((direction) => (
            <li key={direction.href}>
              <Link href={direction.href}>
                <strong>{direction.title}</strong>
                <span>{direction.copy}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
