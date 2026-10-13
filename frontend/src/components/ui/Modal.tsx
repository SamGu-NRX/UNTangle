"use client";

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/**
 * @deprecated Use `Dialog`. Kept so the v1 major picker, plan library,
 * export and persistence panels compile unchanged. `origin` is accepted and
 * ignored: a modal is not anchored to its opener, so it scales from its
 * own centre (DESIGN.md §4 ConnectSheet, emil-design-eng).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 560,
  closable = true,
  role = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  origin?: { x: number; y: number } | null;
  maxWidth?: number;
  closable?: boolean;
  role?: "dialog" | "alertdialog";
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      ariaLabel={typeof title === "string" ? title : "Dialog"}
      width={maxWidth}
      dismissible={closable}
      role={role}
    >
      {children}
    </Dialog>
  );
}
