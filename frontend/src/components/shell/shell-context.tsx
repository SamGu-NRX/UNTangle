"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { SearchItem, SearchSection } from "@/components/ui/SearchPalette";

/**
 * A view's own search for the shell's palette. While a view registers one,
 * ⌘K and the top bar's search field show its results instead of the
 * shell's catalog-only search; the palette stays the shell's.
 */
export type ShellSearchProvider = {
  search: (query: string) => SearchSection[];
  /** Return `true` to keep the palette open (e.g. after ⌘↵ planned a course). */
  onSelect: (item: SearchItem, opts: { plan: boolean }) => boolean | void;
  placeholder?: string;
  emptyQueryHint?: ReactNode;
  planShortcut?: boolean;
};

export type ShellApi = {
  /** Opens the search palette (⌘K on desktop, the full-screen sheet on phones). */
  openSearch: () => void;
  /** Registers the current view's search; `null` restores the shell's own. */
  setSearchProvider: (provider: ShellSearchProvider | null) => void;
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

/**
 * Hands the shell's palette this view's search while the view is mounted.
 * Pass a memoized provider: a new object re-renders the palette's results.
 */
export function useShellSearch(provider: ShellSearchProvider) {
  const { setSearchProvider } = useShell();
  useEffect(() => {
    setSearchProvider(provider);
  }, [provider, setSearchProvider]);
  useEffect(() => () => setSearchProvider(null), [setSearchProvider]);
}
