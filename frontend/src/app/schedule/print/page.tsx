import type { Metadata } from "next";
import { SchedulePrintView } from "@/components/schedule-print-view";

export const metadata: Metadata = { title: "Print week | UNTangle" };

export default function SchedulePrintPage() {
  return <SchedulePrintView />;
}
