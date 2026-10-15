"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, IconButton } from "@/components/ui/Button";
import { AlertGlyph, Close } from "@/components/ui/icons";
import styles from "./builder.module.css";
import { swapText } from "./motion";

/**
 * Text that changes in place: the old words leave through a 2px blur and the
 * new ones arrive (motion.ts swapText). The box keeps its size, so nothing
 * around it reflows (.stripCount fits its longest text). `instant` for
 * changes made from the keyboard. The
 * answer slot around the strip is the live region that announces it.
 */
function SwapText({ text, instant, className, part }: { text: string; instant: boolean; className?: string; part?: string }) {
  const [shown, setShown] = useState(text);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (text === shown) return;
    // Inside the effect the update is ordinary; from the exit's onfinish it is flushed,
    // so the new words are in place before the enter animation's first frame.
    let inEffect = true;
    swapText(ref.current, () => (inEffect ? setShown(text) : flushSync(() => setShown(text))), instant);
    inEffect = false;
  }, [text, shown, instant]);
  return (
    <span ref={ref} className={className} data-part={part}>
      {shown}
    </span>
  );
}

type OptionsProps = {
  /** "2 of 3", or "Updating" while a changed preference is searched again. */
  count: string;
  sentence: string;
  /** Still searching for better weeks: a quiet pulse beside the count. */
  searching: boolean;
  /** The option on the grid improved; Show swaps it in. The grid never moves on its own. */
  better: boolean;
  instant: boolean;
  canUse: boolean;
  hasNext: boolean;
  onDetails: (fromKeyboard: boolean) => void;
  onShow: (fromKeyboard: boolean) => void;
  onNext: (fromKeyboard: boolean) => void;
  onUse: () => void;
  onClose: (fromKeyboard: boolean) => void;
};

const keyboard = (event: { detail: number }) => event.detail === 0;

/** One alternative at a time, in one sentence (untangle-v3.md rule 5). */
export function OptionsStrip(props: OptionsProps) {
  return (
    <div className={styles.strip} role="region" aria-label="Other weeks Auto found">
      <span className={styles.stripCount}>
        <SwapText text={props.count} instant={props.instant} part="count" />
        {props.searching ? <i className={styles.pulse} aria-hidden="true" /> : null}
      </span>
      <SwapText className={styles.stripSentence} text={props.better ? "A better option is ready." : props.sentence} instant={props.instant} part="sentence" />
      <div className={styles.stripActions}>
        {props.better ? (
          <Button variant="quiet" size="sm" onClick={(event) => props.onShow(keyboard(event))}>
            Show
          </Button>
        ) : (
          <Button variant="quiet" size="sm" onClick={(event) => props.onDetails(keyboard(event))}>
            Details
          </Button>
        )}
        {props.hasNext ? (
          <Button variant="secondary" size="sm" onClick={(event) => props.onNext(keyboard(event))}>
            Next
          </Button>
        ) : null}
        <Button size="sm" disabled={!props.canUse} onClick={props.onUse}>
          Use this
        </Button>
        <IconButton label="Keep my week" size="sm" onClick={(event) => props.onClose(keyboard(event))}>
          <Close />
        </IconButton>
      </div>
    </div>
  );
}

/** Nothing fits, an error, or a shared week: the same strip, one sentence and its actions. */
export function NoticeStrip({
  tone,
  children,
  actions,
  onClose,
  closeLabel,
}: {
  tone: "danger" | "brand";
  children: ReactNode;
  actions: ReactNode;
  onClose: (fromKeyboard: boolean) => void;
  closeLabel: string;
}) {
  return (
    <div className={styles.strip} data-tone={tone} role="region" aria-label={tone === "danger" ? "Auto found nothing" : "Shared week"}>
      {tone === "danger" ? <AlertGlyph size={18} className={styles.stripGlyph} /> : null}
      <p className={styles.stripSentence}>
        {children}
      </p>
      <div className={styles.stripActions}>
        {actions}
        <IconButton label={closeLabel} size="sm" onClick={(event) => onClose(keyboard(event))}>
          <Close />
        </IconButton>
      </div>
    </div>
  );
}
