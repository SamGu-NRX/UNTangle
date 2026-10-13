"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./connect.module.css";

/** What a drop hands the Connect sheet: one PDF, or the reason it was refused. */
export type DropResult = { kind: "file"; file: File } | { kind: "error"; message: string };
export type Incoming = DropResult & { id: number };

/** Only drags that carry files (from Finder, Explorer or a download bubble) count. */
export function isFileDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}

function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function readDrop(files: ArrayLike<File>): DropResult {
  if (files.length === 0)
    return { kind: "error", message: "Nothing arrived from that drop. Drop the transcript PDF itself." };
  if (files.length > 1)
    return {
      kind: "error",
      message: `That was ${files.length} files. Drop one PDF: the unofficial transcript you downloaded.`,
    };
  const file = files[0];
  if (!isPdf(file))
    return {
      kind: "error",
      message: `“${file.name}” isn't a PDF. Drop the unofficial transcript PDF you downloaded from myUNT.`,
    };
  return { kind: "file", file };
}

/**
 * dragover repeats every few hundred milliseconds while a drag is over the
 * window, even when the pointer is still, so this long a gap means the drag
 * ended somewhere the leave event didn't reach (e.g. it was cancelled).
 */
const DRAG_GONE_MS = 1000;

/**
 * Drop the transcript anywhere on the app: while a file is dragged over
 * the window, a full-window target shows; dropping it hands the file (or
 * why it was refused) to `onDrop`. Listeners are on the window and the
 * overlay ignores the pointer, so the drop works over dialogs and inert
 * page regions alike. Drags without files (text, links) are left alone.
 */
export function PdfDropTarget({ onDrop }: { onDrop: (result: DropResult) => void }) {
  const [active, setActive] = useState(false);
  const deliver = useEffectEvent(onDrop);

  useEffect(() => {
    let depth = 0;
    let goneTimer = 0;
    const hide = () => {
      depth = 0;
      window.clearTimeout(goneTimer);
      setActive(false);
    };
    const keepAlive = () => {
      window.clearTimeout(goneTimer);
      goneTimer = window.setTimeout(hide, DRAG_GONE_MS);
    };
    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
      keepAlive();
    };
    const onOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Accepting dragover is what makes the window a drop target.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setActive(true);
      keepAlive();
    };
    const onLeave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Enter and leave pair up per element; zero means the drag left the window.
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    };
    const onDropEvent = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Without this the browser would open the PDF in place of the app.
      event.preventDefault();
      hide();
      deliver(readDrop(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDropEvent);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDropEvent);
      window.clearTimeout(goneTimer);
    };
  }, []);

  if (!active) return null;
  return createPortal(
    // Pointer-only: keyboard and screen reader users have "Use the downloaded PDF".
    <div className={styles.dropOverlay} aria-hidden="true" data-testid="pdf-drop-overlay">
      <div className={styles.dropCard}>
        <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M10 3v10M6 9l4 4 4-4M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <strong>Drop the transcript PDF to import it</strong>
        <span>It&apos;s read in this browser, not uploaded.</span>
      </div>
    </div>,
    document.body,
  );
}
