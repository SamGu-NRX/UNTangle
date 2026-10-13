import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ControlsSpecimen } from "@/components/ui/dev/ControlsSpecimen";

export const metadata: Metadata = { title: "Controls", robots: { index: false } };

// Read the gate at request time, so one production build can serve the
// page to a test run (UNTANGLE_DEV_PAGES=1) and 404 everywhere else.
export const dynamic = "force-dynamic";

/** Specimen sheet of every ui/ control and state. Development only. */
export default function ControlsPage() {
  if (process.env.NODE_ENV === "production" && process.env.UNTANGLE_DEV_PAGES !== "1") {
    notFound();
  }
  return <ControlsSpecimen />;
}
