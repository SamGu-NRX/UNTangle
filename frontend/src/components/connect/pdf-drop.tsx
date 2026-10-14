"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { FileGlyph } from "./connect-parts";
import styles from "./connect.module.css";

/** What a drop hands the import page: one PDF, or the reason it was refused. */
export type DropResult = { kind: "file"; file: File } | { kind: "error"; message: string };

/** Only drags that carry files (from Finder, Explorer or a download bubble) count. */
export function isFileDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}

function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * During a drag only the items' types are readable, not their names. A
 * file whose type the OS left empty may still be a PDF, so it doesn't count
 * against the drag; the drop itself is checked by name too (readDrop).
 */
export function dragLooksLikePdf(items: ArrayLike<{ kind: string; type: string }> | null | undefined): boolean {
  const list = Array.from(items ?? []);
  return list.length === 1 && list[0].kind === "file" && (list[0].type === "application/pdf" || list[0].type === "");
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
 * A drop made on another page, waiting for the import page to take it. In
 * memory only: the file never leaves this tab, and a reload drops it.
 */
let handedOver: DropResult | null = null;
export function handOverDrop(result: DropResult) {
  handedOver = result;
}
export function takeHandedDrop(): DropResult | null {
  const result = handedOver;
  handedOver = null;
  return result;
}

/**
 * A drop on the import page: taken now, or, while the session is still
 * loading (nothing can be read for an unknown identity), held the same way a
 * drop from another page is, for the flow to take once it knows who is
 * signed in. A drop never disappears without a word.
 */
export function routeDrop(result: DropResult, ready: boolean, take: (result: DropResult) => void) {
  if (ready) take(result);
  else handOverDrop(result);
}

/**
 * dragover repeats every few hundred milliseconds while a drag is over the
 * window, even when the pointer is still, so this long a gap means the drag
 * ended somewhere the leave event didn't reach (e.g. it was cancelled).
 */
const DRAG_GONE_MS = 1000;

type Drag = "off" | "pdf" | "other";

/**
 * Drop the transcript anywhere: while a file is dragged over the window, a
 * full-window target shows, in grey with "Only PDF transcripts work" when
 * the drag is not one PDF. Dropping hands the file (or why it was refused)
 * to `onDrop`. Listeners are on the window and the overlay ignores the
 * pointer, so the drop works over dialogs and inert regions alike. Drags
 * without files (text, links) are left alone, and so are coarse pointers,
 * which have no drag from a file manager (HANDOFF.md §4).
 */
export function PdfDropTarget({ onDrop }: { onDrop: (result: DropResult) => void }) {
  const [drag, setDrag] = useState<Drag>("off");
  const deliver = useEffectEvent(onDrop);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let depth = 0;
    let goneTimer = 0;
    const hide = () => {
      depth = 0;
      window.clearTimeout(goneTimer);
      setDrag("off");
    };
    const keepAlive = () => {
      window.clearTimeout(goneTimer);
      goneTimer = window.setTimeout(hide, DRAG_GONE_MS);
    };
    const show = (event: DragEvent) => setDrag(dragLooksLikePdf(event.dataTransfer?.items) ? "pdf" : "other");
    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      event.preventDefault();
      depth += 1;
      show(event);
      keepAlive();
    };
    const onOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Accepting dragover is what makes the window a drop target.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      show(event);
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

  if (drag === "off") return null;
  const pdf = drag === "pdf";
  return createPortal(
    // Pointer-only: keyboard and screen reader users have "Choose file" and "Use the downloaded PDF".
    // data-ui: the overlay keeps its own reduced-motion fade (connect.module.css), not globals.css's.
    <div className={styles.drop} data-bad={pdf ? undefined : ""} aria-hidden="true" data-testid="pdf-drop-overlay" data-ui="">
      <div className={styles.dropFrame} data-ui="" />
      <div className={styles.dropInner}>
        <span className={styles.dropBadge}>
          <FileGlyph size={28} />
        </span>
        <strong className={styles.dropTitle}>{pdf ? "Drop your transcript" : "Only PDF transcripts work"}</strong>
        <span className={styles.dropMeta}>
          {pdf ? "Read on this device. Nothing is uploaded." : "Download the PDF from myUNT first."}
        </span>
      </div>
    </div>,
    document.body,
  );
}
