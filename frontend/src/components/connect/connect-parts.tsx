import styles from "./connect.module.css";
export function StepDots({ current }: { current: 0 | 1 | 2 | 3 }) {
  return <ol className={styles.steps} aria-label="Import steps">{["Open", "Import", "Review"].map((name, i) => <li key={name} data-state={i < current ? "done" : i === current ? "current" : "pending"} aria-current={i === current ? "step" : undefined}>{name}</li>)}</ol>;
}
export function BrowserCard({ href }: { href: string }) {
  return <div className={styles.browser}>
    <div className={styles.browserChrome}><span aria-hidden="true">•••</span><span>my.unt.edu › Academic Records</span></div>
    <div className={styles.browserBody}><span className={styles.seal} aria-hidden="true">U</span><p>Open your unofficial transcript in myUNT.</p><a className={styles.primary} href={href} target="_blank" rel="noopener noreferrer">Open myUNT <span aria-hidden="true">↗</span></a><small>Opens a new tab. Sign in there.</small></div>
  </div>;
}
