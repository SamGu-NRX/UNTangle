import type { ChangeEvent, ReactNode } from "react";
import styles from "./connect.module.css";

const STEPS = ["Open", "Import", "Review"] as const;

/**
 * Open · Import · Review. 6px dots: current brand, done brand with a ring,
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
 * The in-app-browser feel: a small browser frame with the myUNT breadcrumb
 * and the one primary action, opening the transcript page in a new tab.
 */
export function BrowserCard({
  href,
  onOpen,
  children,
}: {
  href: string;
  onOpen?: () => void;
  /** Replaces the default line under the button (e.g. waiting status). */
  children?: ReactNode;
}) {
  return (
    <div className={styles.browser}>
      <div className={styles.browserChrome} aria-hidden="true">
        <span className={styles.browserDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.browserUrl}>
          <b>my.unt.edu</b> › Academic Records › Unofficial Transcript
        </span>
      </div>
      <div className={styles.browserBody}>
        <span className={styles.untMark} aria-hidden="true">
          UNT
        </span>
        {children ?? <p>Opens in a new tab. Sign in there as usual.</p>}
        <a className="ui-btn ui-btn--primary" href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} data-ui="">
          Open myUNT <span aria-hidden="true" className={styles.trail}>↗</span>
          <span className="sr-only-v2"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}

/** The one file input. Its name stays "Upload transcript PDF" wherever it shows. */
export function UploadInput({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <input
      type="file"
      className={styles.fileInput}
      disabled={disabled}
      accept="application/pdf,.pdf"
      aria-label="Upload transcript PDF"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onFile(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );
}

/**
 * Where the PDF lands: a dashed drop target on desktop ("Drop the transcript
 * PDF here, or choose a file"), a full-width "Choose the PDF" button on
 * phones, where the file is in Files › Downloads.
 */
export function DropZone({
  dragging,
  disabled,
  tall,
  onFile,
}: {
  dragging: boolean;
  disabled: boolean;
  /** The whole body of the upload view: 160px instead of 96px. */
  tall?: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label className={styles.drop} data-dragging={dragging || undefined} data-tall={tall || undefined}>
      <UploadInput disabled={disabled} onFile={onFile} />
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M10 13V3M6 7l4-4 4 4M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.dropFine}>
        Drop the transcript PDF here, or <u>choose a file</u>
      </span>
      <span className={styles.dropCoarse}>
        <span className="ui-btn ui-btn--primary">Choose the PDF</span>
        <small>It&apos;s in Files › Downloads.</small>
      </span>
    </label>
  );
}

/** Shown while the desktop extension is connected and listening. */
export function ExtensionRow() {
  return (
    <p className={styles.extension}>
      <span className={styles.liveDot} aria-hidden="true" />
      UNTangle extension connected
    </p>
  );
}
