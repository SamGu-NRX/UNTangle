import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ControlsSpecimen } from "@/components/ui/dev/ControlsSpecimen";

export const metadata: Metadata = { title: "Controls", robots: { index: false } };

// Decided when the page is built: `next dev` always serves it, and a
// production build serves it only when built with UNTANGLE_DEV_PAGES=1.
// Every other production build renders a 404 here.
export const dynamic = "force-static";

/** Specimen sheet of every ui/ control and state. */
export default function ControlsPage() {
  if (process.env.NODE_ENV === "production" && process.env.UNTANGLE_DEV_PAGES !== "1") {
    notFound();
  }
  return <ControlsSpecimen />;
}
