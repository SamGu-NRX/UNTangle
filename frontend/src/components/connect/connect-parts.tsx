import type { ChangeEvent, Ref } from "react";
import styles from "./connect.module.css";

/**
 * The file input behind "Choose file" and "Use the downloaded PDF" where
 * the browser has no File System Access picker. Visible buttons click it;
 * it is out of the tab order and the accessibility tree, so the PDF has one
 * control, not two.
 */
export function HiddenPdfInput({ ref, onFile }: { ref: Ref<HTMLInputElement>; onFile: (file: File | undefined) => void }) {
  return (
    <input
      ref={ref}
      type="file"
      className={styles.fileInput}
      accept="application/pdf,.pdf"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onFile(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );
}

type GlyphProps = { size?: number };

/** A page with a folded corner: the transcript PDF. */
export function FileGlyph({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 2.5h6.5L15.5 6.5v11H5z" />
      <path d="M11.5 2.5v4h4" />
    </svg>
  );
}

/** A browser window: Open myUNT opens one. */
export function WindowGlyph({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="M2.5 7.5h15" />
      <circle cx="5.2" cy="5.8" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** "!" in a ring, for the screens that say a file can't be used. */
export function AlertGlyph({ size = 22 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M10 5.5v5.5" />
      <circle cx="10" cy="14.2" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}
