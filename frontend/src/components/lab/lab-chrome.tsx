"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { NavShell } from "@/components/nav-shell";
import { writePlannerStateToSessionStorage } from "@/lib/planner";
import { labPlannerState } from "@/lib/lab/lab-plans";

const DIRECTIONS = [
  { id: "a", href: "/lab/a", label: "A · Week grid + day map" },
  { id: "b", href: "/lab/b", label: "B · Day itinerary" },
  { id: "c", href: "/lab/c", label: "C · Map + bottom sheet" },
] as const;

export type LabDirectionId = (typeof DIRECTIONS)[number]["id"];

export function LabChrome({
  direction,
  title,
  description,
  children,
}: {
  direction: LabDirectionId;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="lab-root">
      <NavShell step={1} stickyFooter={false}>
        <div className="lab-shell">
          <nav className="lab-switch" aria-label="UX direction navigation">
            <Link className="lab-switch__home" href="/lab">
              Round 1 lab
            </Link>
            {DIRECTIONS.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="lab-switch__item"
                aria-current={item.id === direction ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              className="lab-switch__reset"
              onClick={() => {
                writePlannerStateToSessionStorage(labPlannerState);
                window.location.reload();
              }}
            >
              Reset sample plan
            </button>
          </nav>
          <header className="lab-header">
            <h1 className="font-display">{title}</h1>
            <p>{description}</p>
          </header>
          <p className="lab-sample" role="status" aria-label="Sample data notice">
            Sample data: every section below is a synthetic sample (15 buildings, no real
            term) — not a real UNT schedule.
          </p>
          {children}
        </div>
      </NavShell>
    </div>
  );
}
