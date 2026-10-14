"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectHost } from "@/components/connect/connect-host";
import { noteNavigation } from "@/components/ui/back-close";
import { SearchPalette } from "@/components/ui/SearchPalette";
import { Toaster } from "@/components/ui/Toast";
import { WebMcpTools } from "@/components/webmcp/WebMcpTools";
import { courses } from "@/lib/seed-data";
import { courseHref, searchCourses } from "./course-search";
import { useLensMemory } from "./lens-memory";
import { lensForPath, shellModeFor } from "./routes";
import { ShellContext, type ShellApi, type ShellSearchProvider } from "./shell-context";
import { TabBar } from "./TabBar";
import { PhoneHeader, TopBar } from "./TopBar";

/**
 * The persistent frame around every app route (DESIGN.md §3): the top bar on
 * desktop, the phone header and tab bar on phones, the routed lens in
 * <main>, the ⌘K search and the toast region. It lives in the root layout,
 * so it stays mounted while the student moves between Courses, Week and
 * Day, and it remembers where each lens was left. Sign-in, print and /dev
 * routes are drawn bare (routes.ts).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const mode = shellModeFor(pathname);
  const lens = lensForPath(pathname);
  const { hrefs, pick } = useLensMemory(lens, pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lastPath, setLastPath] = useState(pathname);
  // The routed lens's own search (Courses), when it registers one.
  const [provider, setSearchProvider] = useState<ShellSearchProvider | null>(null);
  // Page state that outlives the page while the student visits other lenses.
  const [pageState] = useState(() => new Map<string, unknown>());

  if (lastPath !== pathname) {
    // A navigation closes the search.
    setLastPath(pathname);
    setSearchOpen(false);
  }

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const api = useMemo<ShellApi>(() => ({ openSearch, setSearchProvider, pageState }), [openSearch, pageState]);

  // Sheets judge Back against the entry we are on; a route change moved it.
  useEffect(() => noteNavigation(), [pathname]);

  // ⌘K / Ctrl+K toggles the search from anywhere in the app.
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
      <div className="shell" data-lens={lens ?? "none"}>
        <a href="#main" className="shell-skip">
          Skip to content
        </a>
        <TopBar lens={lens} hrefs={hrefs} onPick={pick} onSearch={openSearch} />
        <PhoneHeader />
        <main id="main" className="shell-main" tabIndex={-1}>
          {children}
        </main>
        <TabBar lens={lens} hrefs={hrefs} onPick={pick} />
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
      <ConnectHost />
      <Toaster />
      <WebMcpTools />
    </ShellContext.Provider>
  );
}
