import type { Metadata } from "next";
import { PlansClient } from "@/components/saved-plans/plans-client";

export const metadata: Metadata = { title: "Schedules" };

export default function SchedulesPage() {
  return <PlansClient />;
}
