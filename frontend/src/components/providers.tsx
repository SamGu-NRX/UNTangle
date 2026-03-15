"use client";

import { PlannerProvider } from "@/components/planner-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <PlannerProvider>{children}</PlannerProvider>;
}
