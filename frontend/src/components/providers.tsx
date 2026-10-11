"use client";

import { PlannerProvider, ToastProvider } from "@/components/planner-provider";
import { SessionExpiryDialog } from "@/components/session-expiry-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlannerProvider>
        <ToastProvider>{children}</ToastProvider>
      </PlannerProvider>
      <SessionExpiryDialog />
    </>
  );
}
