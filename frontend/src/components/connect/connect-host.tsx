"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Dialog } from "@/components/ui/Dialog";
import { useIsClient } from "@/components/ui/Toast";
import { ConnectSheet } from "./connect-sheet";
import { CONNECT_PATH, OPEN_CONNECT_EVENT } from "./open-connect";

/** Marks a /connect history entry pushed over a view. Next keeps its own keys alongside. */
const FROM_VIEW_KEY = "untangleConnectFromView";
const openedOverView = () =>
  Boolean((window.history.state as Record<string, unknown> | null)?.[FROM_VIEW_KEY]);

const PHONE_QUERY = "(max-width: 719px)";
const subscribePhone = (onChange: () => void) => {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};

/**
 * Hosts the Connect sheet over whatever view is showing (DESIGN.md §4
 * ConnectSheet): a 480px dialog on desktop, a 92% bottom sheet on phones.
 *
 * The sheet is open exactly while the URL is /connect, because the
 * extension's bridge only answers on that path (extension/src/bridge.ts).
 * `openConnect()` therefore moves the URL to /connect with the native
 * history API: Next syncs the pathname without rendering a new page, so the
 * current view stays underneath. That history entry is marked
 * (FROM_VIEW_KEY in history.state), so closing goes Back to the view, also
 * after Back/Forward through it. Loading /connect directly opens the sheet
 * over an empty page, and closing it then goes to Courses.
 */
export function ConnectHost() {
  const pathname = usePathname();
  const router = useRouter();
  const isClient = useIsClient();
  const isPhone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const open = isClient && pathname === CONNECT_PATH;

  useEffect(() => {
    const onOpen = (event: Event) => {
      // Claim the request so the sender does not fall back to navigating.
      event.preventDefault();
      if (window.location.pathname === CONNECT_PATH) return;
      window.history.pushState({ [FROM_VIEW_KEY]: true }, "", CONNECT_PATH);
    };
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    if (openedOverView()) {
      window.history.back();
    } else {
      router.push("/courses");
    }
  }, [router]);

  const onOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const sheet = <ConnectSheet headingRef={headingRef} onClose={close} />;
  if (isPhone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Connect myUNT"
        detents={["92%"]}
        initialFocus={headingRef}
        className="connect-host-sheet"
      >
        {sheet}
      </BottomSheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} ariaLabel="Connect myUNT" width={480} initialFocus={headingRef}>
      {sheet}
    </Dialog>
  );
}
