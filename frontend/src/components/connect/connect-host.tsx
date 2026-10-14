"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Dialog } from "@/components/ui/Dialog";
import { useIsClient } from "@/components/ui/Toast";
import { ConnectSheet } from "./connect-sheet";
import { CLOSED_FRAME, nextFrame } from "./host-frame";
import { CONNECT_PATH, OPEN_CONNECT_EVENT } from "./open-connect";
import { PdfDropTarget, type DropResult, type Incoming } from "./pdf-drop";
import { clearTripFlag, readTripFlag } from "./trip-flag";

/** Marks a /connect history entry pushed over a view. Next keeps its own keys alongside. */
const FROM_VIEW_KEY = "untangleConnectFromView";
const openedOverView = () =>
  Boolean((window.history.state as Record<string, unknown> | null)?.[FROM_VIEW_KEY]);
/** Moves to /connect over the current view; Next syncs the pathname without rendering a new page. */
function pushConnect() {
  if (window.location.pathname === CONNECT_PATH) return;
  window.history.pushState({ [FROM_VIEW_KEY]: true }, "", CONNECT_PATH);
}

const PHONE_QUERY = "(max-width: 759px)";
const subscribePhone = (onChange: () => void) => {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};

const TITLE = "Import from myUNT";

/**
 * Hosts the Connect sheet over whatever view is showing (DESIGN.md §4
 * ConnectSheet): a 480px dialog on desktop, a 92% bottom sheet on phones,
 * chosen when the sheet opens and kept until it closes (host-frame.ts).
 *
 * The sheet is open exactly while the URL is /connect, so it has an address
 * that survives a reload (phones reload after the trip to myUNT) and Back
 * closes it. `openConnect()` moves the URL there with the native history
 * API, so the current view stays underneath. That history entry is marked
 * (FROM_VIEW_KEY in history.state), so closing goes Back to the view, also
 * after Back/Forward through it. Loading /connect directly opens the sheet
 * over an empty page, and closing it then goes to Courses.
 *
 * It also owns the page-wide PDF drop: a transcript dropped anywhere opens
 * the sheet, if needed, and is handed to it.
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
  const [frame, setFrame] = useState(CLOSED_FRAME);
  const next = nextFrame(frame, open, isPhone, readTripFlag);
  if (next !== frame) setFrame(next);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const dropCount = useRef(0);

  useEffect(() => {
    const onOpen = (event: Event) => {
      // Claim the request so the sender does not fall back to navigating.
      event.preventDefault();
      pushConnect();
    };
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
  }, []);

  // The trip flag is consumed once the sheet has opened from it, and
  // cleared when the sheet closes by any route (button, Escape, Back).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open !== wasOpen.current) clearTripFlag();
    wasOpen.current = open;
  }, [open]);

  const close = useCallback(() => {
    if (openedOverView()) {
      window.history.back();
    } else {
      router.push("/courses");
    }
  }, [router]);

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) close();
  };

  const onDrop = (result: DropResult) => {
    dropCount.current += 1;
    setIncoming({ ...result, id: dropCount.current });
    pushConnect();
  };
  const onIncomingTaken = useCallback((id: number) => {
    setIncoming((current) => (current?.id === id ? null : current));
  }, []);

  const sheet = (
    <ConnectSheet
      headingRef={headingRef}
      onClose={close}
      restoreTrip={frame.restoreTrip}
      incoming={incoming}
      onIncomingTaken={onIncomingTaken}
    />
  );
  return (
    <>
      <PdfDropTarget onDrop={onDrop} />
      {frame.phone ? (
        <BottomSheet
          open={open}
          onOpenChange={onOpenChange}
          title={TITLE}
          detents={["92%"]}
          // Connect has its own URL (/connect), so Back already closes it.
          closeOnBack={false}
          initialFocus={headingRef}
          className="connect-host-sheet"
        >
          {sheet}
        </BottomSheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange} ariaLabel={TITLE} width={480} initialFocus={headingRef}>
          {sheet}
        </Dialog>
      )}
    </>
  );
}
