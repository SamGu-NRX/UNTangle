"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { TextField } from "./TextField";

/**
 * @deprecated Use `TextField`. Kept so v1 callers (auth, forgot password)
 * compile unchanged: `helper` maps to `help`, `rightSlot` to `trailing`.
 */
export function Field({
  label,
  helper,
  error,
  rightSlot,
  ...rest
}: Omit<ComponentPropsWithRef<"input">, "size"> & {
  label: string;
  helper?: ReactNode;
  error?: string | null;
  rightSlot?: ReactNode;
}) {
  return <TextField label={label} help={helper} error={error} trailing={rightSlot} {...rest} />;
}
