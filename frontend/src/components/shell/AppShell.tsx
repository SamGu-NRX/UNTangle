"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SearchPalette } from "@/components/ui/SearchPalette";
import { Toaster } from "@/components/ui/Toast";
import { courses } from "@/lib/seed-data";
import { BottomTabs } from "./BottomTabs";
import { courseHref, searchCourses } from "./course-search";
import { shellModeFor, viewForPath } from "./routes";
import { ShellContext, type ShellApi, type ShellSearchProvider } from "./shell-context";
import { TopBar } from "./TopBar";

/**
 * The persistent frame around every app route (DESIGN.md §2): TopBar,
 * the routed view in <main>, BottomTabs on phones, the ⌘K palette and the
 * toast region. It lives in the root layout, so views render inside it
 * without importing it, and it stays mounted while the student moves
 * between Courses, Week and Map. Sign-in, print and /dev routes are drawn
 * bare (routes.ts).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const mode = shellModeFor(pathname);
  const view = viewForPath(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lastPath, setLastPath] = useState(pathname);
  // The routed view's own search (Courses), when it registers one.
  const [provider, setSearchProvider] = useState<ShellSearchProvider | null>(null);

  if (lastPath !== pathname) {
    // A navigation closes the palette.
    setLastPath(pathname);
    setSearchOpen(false);
  }

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const api = useMemo<ShellApi>(() => ({ openSearch, setSearchProvider }), [openSearch]);

  // ⌘K / Ctrl+K toggles the palette from anywhere in the app.
  useEffect(() => {
    if (mode !== "app") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const results = useMemo(() => searchCourses(courses, query), [query]);
  const sections = provider ? provider.search(query) : [{ id: "courses", label: "Courses", items: results }];

  if (mode === "bare") {
    return (
      <>
        {children}
        <Toaster />
      </>
    );
  }

  return (
    <ShellContext.Provider value={api}>
      <div className="shell" data-view={view ?? "none"}>
        <a href="#main" className="shell-skip">
          Skip to content
        </a>
        <TopBar view={view} onSearch={openSearch} />
        <main id="main" className="shell-main" tabIndex={-1}>
          {children}
        </main>
        <BottomTabs view={view} />
      </div>
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={query}
        onQueryChange={setQuery}
        sections={sections}
        placeholder={provider?.placeholder}
        emptyQueryHint={provider?.emptyQueryHint}
        planShortcut={provider?.planShortcut}
        onSelect={(item, opts) => {
          if (provider) {
            if (provider.onSelect(item, opts) === true) return;
            setSearchOpen(false);
            setQuery("");
            return;
          }
          setSearchOpen(false);
          setQuery("");
          if (item.code) router.push(courseHref(item.code));
        }}
      />
      <Toaster />
    </ShellContext.Provider>
  );
}
