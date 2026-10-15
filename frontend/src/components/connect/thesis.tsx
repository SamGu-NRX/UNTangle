import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { FileGlyph } from "./connect-parts";
import styles from "./connect.module.css";

/** Course-colored bars for the small week: [day, hue, top %, height %]. Illustration only. */
const WEEK: Array<[number, number, number, number]> = [
  [0, 1, 8, 18], [0, 3, 34, 18], [0, 2, 60, 18],
  [1, 4, 45, 26],
  [2, 1, 8, 18], [2, 3, 34, 18], [2, 2, 60, 18],
  [3, 4, 45, 26],
  [4, 1, 8, 18], [4, 3, 34, 18],
];

/**
 * The first visit's right side on desktop (DESIGN.md §4.1): what the
 * transcript becomes, as four artifacts on one path line. It is also where
 * the myUNT popup lands, so it never covers the steps on the left. Every
 * figure in it is an example, and it says so to a screen reader.
 */
export function Thesis() {
  return (
    <aside className={styles.thesis} aria-label="Example: what UNTangle does with your transcript">
      <ol className={styles.thesisList}>
        <li>
          <span className={styles.thesisStop} aria-hidden="true">1</span>
          <div className={styles.art}>
            <div className={styles.artCap}>Your transcript</div>
            <div className={styles.artFile}>
              <FileGlyph />
              <span>unofficial-transcript.pdf</span>
              <span className={styles.artMeta}>stays on this device</span>
            </div>
          </div>
        </li>
        <li>
          <span className={styles.thesisStop} aria-hidden="true">2</span>
          <div className={styles.art}>
            <div className={styles.artCap}>What you can take</div>
            <div className={styles.artRow}>
              <StatusGlyph status="done" />
              <span className="ui-code">MATH 1720</span>
              <span>Calculus II</span>
              <span className={styles.artMeta}>Grade B</span>
            </div>
            <div className={styles.artRow}>
              <StatusGlyph status="available" label="Can take" />
              <span className="ui-code">CSCE 2110</span>
              <span>Data Structures</span>
              <span className={styles.artMeta}>Can take</span>
            </div>
            <div className={styles.artRow}>
              <StatusGlyph status="locked" />
              <span className="ui-code">CSCE 3110</span>
              <span>Algorithms</span>
              <span className={styles.artMeta}>Needs 2110</span>
            </div>
          </div>
        </li>
        <li>
          <span className={styles.thesisStop} aria-hidden="true">3</span>
          <div className={styles.art}>
            <div className={styles.artCap}>Next term&apos;s week</div>
            <div className={styles.miniWeek} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((day) => (
                <div key={day}>
                  {WEEK.filter(([d]) => d === day).map(([, hue, top, height]) => (
                    <i
                      key={top}
                      style={{ top: `${top}%`, height: `${height}%`, background: `var(--c${hue}t)`, borderLeftColor: `var(--c${hue})` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </li>
        <li>
          <span className={styles.thesisStop} aria-hidden="true">4</span>
          <div className={styles.art}>
            <div className={styles.artCap}>Your walk</div>
            <div className={styles.artWalk}>
              <div>
                <div className={styles.artMeta}>Leave Kerr by</div>
                <div className={styles.artBig}>8:49</div>
              </div>
              <svg className={styles.artRoute} viewBox="0 0 120 44" aria-hidden="true">
                <path d="M8 36 C 40 36, 40 10, 70 12 S 104 20, 112 8" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
                <path d="M8 36 C 40 36, 40 10, 70 12 S 104 20, 112 8" fill="none" stroke="var(--brand-2)" strokeWidth="4" strokeLinecap="round" />
                <circle cx="8" cy="36" r="5" fill="#fff" stroke="var(--ink-2)" strokeWidth="2" />
                <circle cx="112" cy="8" r="6" fill="var(--brand)" stroke="#fff" strokeWidth="2" />
              </svg>
            </div>
          </div>
        </li>
      </ol>
    </aside>
  );
}
