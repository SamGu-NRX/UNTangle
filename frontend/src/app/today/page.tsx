import type { Metadata, Viewport } from "next";
import { TodayClient } from "@/components/today/today-client";
import { usePlanner } from "@/components/planner/planner-provider";

export const metadata: Metadata = {
  title: "Today — UNTangle",
  description: "Where you need to be right now, and how to get to the next class.",
};

export const viewport: Viewport = {
  themeColor: "#166534",
};

export default function TodayPage() {
  const { events, resolve } = usePlanner();
  return <TodayClient events={events} resolve={resolve} />;
}
