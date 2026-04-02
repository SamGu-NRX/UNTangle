"use client";

import type { ReactNode } from "react";

export function ConflictBanner({ children }: { children: ReactNode }) {
  return (
    <div className="conflict-banner" role="alert">
      <span aria-hidden style={{ fontSize: 16 }}>!</span>
      <span>{children}</span>
    </div>
  );
}
