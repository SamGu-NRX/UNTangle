"use client";

import { PlannerProvider, ToastProvider } from "@/components/planner-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PlannerProvider>
      <ToastProvider>{children}</ToastProvider>
    </PlannerProvider>
  );
}
