import { useEffect } from "react";

/**
 * Screens hold the update flow while a moment is open that a restart must
 * never interrupt: reviewing an import, resolving a conflict or approving
 * Auto (docs/architecture/README.md, "Mobile"). A restart replaces the whole
 * JavaScript runtime and what such a moment shows lives only in memory, so
 * the downloaded update simply waits until every hold is closed and the app next
 * backgrounds.
 *
 * Holds refcount by label, so two mounted screens marking the same kind of
 * moment cannot release each other's hold.
 */
const holdCounts = new Map<string, number>();

export function beginUnsafeMoment(label: string): void {
  holdCounts.set(label, (holdCounts.get(label) ?? 0) + 1);
}

export function endUnsafeMoment(label: string): void {
  const count = holdCounts.get(label) ?? 0;
  if (count <= 1) {
    holdCounts.delete(label);
    return;
  }
  holdCounts.set(label, count - 1);
}

/** For tests and diagnostics. */
export function unsafeMomentCount(): number {
  return holdCounts.size;
}

/** True when no screen holds an unsafe moment open. */
export function isSafeToApply(): boolean {
  return holdCounts.size === 0;
}

/**
 * Marks the moment the component is showing as unsafe while `active`. Pass a
 * stable label naming the moment, for example "import-review" or "auto".
 */
export function useUnsafeMoment(active: boolean, label: string): void {
  useEffect(() => {
    if (!active) return;
    beginUnsafeMoment(label);
    return () => endUnsafeMoment(label);
  }, [active, label]);
}
