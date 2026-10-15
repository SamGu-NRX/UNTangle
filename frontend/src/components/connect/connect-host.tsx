"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CONNECT_PATH, OPEN_CONNECT_EVENT } from "./open-connect";
import { handOverDrop, PdfDropTarget, type DropResult } from "./pdf-drop";

/**
 * The import page's reach into the rest of the app, mounted by the shell:
 * it answers `openConnect()` with an in-app navigation to /connect, and a
 * transcript dropped on any page goes to /connect and is read there. The
 * import page itself (bare, outside the shell) runs its own drop target.
 */
export function ConnectHost() {
  const router = useRouter();

  useEffect(() => {
    const onOpen = (event: Event) => {
      // Claim the request so the sender does not fall back to a full page load.
      event.preventDefault();
      router.push(CONNECT_PATH);
    };
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
  }, [router]);

  const onDrop = (result: DropResult) => {
    handOverDrop(result);
    router.push(CONNECT_PATH);
  };
  return <PdfDropTarget onDrop={onDrop} />;
}
