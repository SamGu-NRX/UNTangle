import type { Metadata } from "next";
import { SchedulesClient } from "@/components/schedules-library/schedules-client";

export const metadata: Metadata = { title: "Schedules" };

export default function SchedulesPage() {
  return <SchedulesClient />;
}
