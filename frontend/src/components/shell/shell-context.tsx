"use client";

import { createContext, useContext } from "react";

export type ShellApi = {
  /** Opens the search palette (⌘K on desktop, the full-screen sheet on phones). */
  openSearch: () => void;
};

export const ShellContext = createContext<ShellApi | null>(null);

/**
 * For views inside the app shell, e.g. the Courses search field opening the
 * phone search sheet on focus. Throws outside the shell rather than
 * silently doing nothing.
 */
export function useShell(): ShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error("useShell must be used inside AppShell (a route drawn with the app shell).");
  return api;
}
