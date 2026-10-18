"use client";

import styles from "./library.module.css";

/**
 * Said beside every "Use in Main" while Main has no saved copy: after the
 * Undo toast goes, the Main being replaced can't be brought back.
 */
export function UnsavedMainNote({ onSaveMain }: { onSaveMain: () => void }) {
  return (
    <p className={styles.warn}>
      Main has no saved copy yet.{" "}
      <button type="button" className={styles.inline} onClick={onSaveMain}>
        Save a copy first
      </button>
    </p>
  );
}
