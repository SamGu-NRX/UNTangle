import type { ChangeEvent, Ref } from "react";
import styles from "./connect.module.css";

const STEPS = ["Open", "Import", "Review"] as const;

/**
 * Open, Import and Review. 6px dots: current brand, done brand with a ring,
 * pending line-strong. Fixed at the top while the content below changes.
 */
export function StepDots({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol className={styles.steps} aria-label="Import steps">
      {STEPS.map((name, i) => (
        <li
          key={name}
          data-state={i < current ? "done" : i === current ? "current" : "pending"}
          aria-current={i === current ? "step" : undefined}
        >
          {name}
        </li>
      ))}
    </ol>
  );
}

/**
 * The file input behind "Use the downloaded PDF" where the browser has no
 * File System Access picker. Visible buttons click it; it is out of the tab
 * order and the accessibility tree, so the PDF has one control, not two.
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
