import type { ReactNode } from "react";
import { cx } from "./cx";

/** A key cap: 18px tall, 11px, surface-2 with a hairline. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("ui-kbd", className)}>{children}</kbd>;
}
