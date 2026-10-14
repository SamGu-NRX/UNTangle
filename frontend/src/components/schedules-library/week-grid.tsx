"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Hue } from "@/lib/course-colors";
import { clockText, gridDays, type PlacedBlock, type WeekBlock } from "@/lib/plan-library/week";
import type { ClassDay } from "@/lib/types";
import styles from "./library.module.css";



/** Hours shown: at least 8 to 5, widened to whole hours around any class outside that. */
function hourRange(items: readonly WeekBlock[]): [number, number] {
  const first = Math.min(8 * 60, ...items.map((item) => item.start));
  const last = Math.max(17 * 60, ...items.map((item) => item.end));
  return [Math.floor(first / 60), Math.ceil(last / 60)];
}


const hueStyle = (hue: Hue | undefined): CSSProperties =>
  ({ "--c": `var(--c${hue ?? 1})`, "--ct": `var(--c${hue ?? 1}t)` }) as CSSProperties;

/** A schedule's week drawn small in a list row: bars only, no words. */
export function WeekThumb({ blocks, colors }: { blocks: readonly WeekBlock[]; colors: ReadonlyMap<string, Hue> }) {
  const [from, to] = hourRange(blocks);
  const span = (to - from) * 60;
  return (
    <div className={styles.thumb} aria-hidden="true" style={{ "--days": gridDays(blocks).length } as CSSProperties}>
      {gridDays(blocks).map((day) => (
        <div key={day}>
          {blocks
            .filter((block) => block.day === day)
            .map((block) => (
              <i
                key={block.key}
                style={{
                  ...hueStyle(colors.get(block.code)),
                  top: `${((block.start - from * 60) / span) * 100}%`,
                  height: `${((block.end - block.start) / span) * 100}%`,
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The week in the detail and compare panel. Blocks keep their `id` across
 * layouts, so when `layout` changes from a pointer, each block glides from
 * its old slot to its new one (MOTION.md §3, "Compare views": a 300ms FLIP
 * on --ease-in-out) and new blocks fade in over 160ms. Changed from the
 * keyboard, or under reduced motion, it redraws at once. The drawing is
 * hidden from assistive tech, which reads the same meetings as a list.
 */
export function WeekGrid({
  items,
  colors,
  layout,
  animate,
  labels,
}: {
  items: readonly PlacedBlock[];
  colors: ReadonlyMap<string, Hue>;
  /** Names the arrangement; a change of name is what animates. */
  layout: string;
  /** False for keyboard changes. */
  animate: boolean;
  /** Which schedule each kind of block belongs to, said after each meeting in the list. */
  labels?: Partial<Record<PlacedBlock["variant"], string>>;
}) {
  const [from, to] = hourRange(items);
  const span = (to - from) * 60;
  const days = gridDays(items);
  const layer = useRef<HTMLDivElement | null>(null);
  const last = useRef<{ layout: string; slots: Map<string, { x: number; y: number }> } | null>(null);

  // FLIP: every block's slot is recorded after each commit; when the layout name changed,
  // each block plays from where it was on screen. Blocks live in one layer, so a block that
  // changes day keeps its element, and one still gliding from an earlier change starts from
  // its old slot plus the offset it had reached: a quick second press never jumps. All reads
  // come before the writes (MOTION.md §11). From the keyboard or under reduced motion, any
  // glide in progress stops and the new layout shows at once.
  useLayoutEffect(() => {
    const root = layer.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-id]")];
    // Slots are offsets, which ignore transforms, so a running glide doesn't skew them.
    const slots = new Map(nodes.map((node) => [node.dataset.id!, { x: node.offsetLeft, y: node.offsetTop }]));
    const previous = last.current;
    last.current = { layout, slots };
    if (!previous || previous.layout === layout) return;
    const glide = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reached = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      if (!node.getAnimations().length) continue;
      const offset = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      const was = previous.slots.get(node.dataset.id!);
      if (was) reached.set(node.dataset.id!, { x: was.x + offset.m41, y: was.y + offset.m42 });
    }
    for (const node of nodes) {
      node.getAnimations().forEach((animation) => animation.cancel());
      if (!glide) continue;
      const was = reached.get(node.dataset.id!) ?? previous.slots.get(node.dataset.id!);
      const now = slots.get(node.dataset.id!)!;
      if (!was) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(.23, 1, .32, 1)" });
        continue;
      }
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 300,
        // --ease-in-out: things already on screen that move.
        easing: "cubic-bezier(.77, 0, .175, 1)",
      });
    }
  }, [items, layout, animate]);

  return (
    <div className={styles.grid}>
      <div aria-hidden="true">
        <div className={styles.gridHead} style={{ "--days": days.length } as CSSProperties}>
          <span />
          {days.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className={styles.gridBody} style={{ "--days": days.length, "--hours": to - from } as CSSProperties}>
          <div className={styles.gutter}>
            {Array.from({ length: to - from - 1 }, (_, i) => (
              <span key={i} style={{ top: `${((i + 1) / (to - from)) * 100}%` }}>
                {clockText((from + i + 1) * 60).replace(":00", "")}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className={styles.col} />
          ))}
          <div ref={layer} className={styles.events}>
            {items.map((item) => (
              <span
                key={item.id}
                data-id={item.id}
                data-variant={item.variant}
                className={styles.event}
                style={{
                  ...hueStyle(colors.get(item.code)),
                  left: `calc(${(days.indexOf(item.day) / days.length) * 100}% + 3px)`,
                  width: `calc(${100 / days.length}% - 6px)`,
                  top: `${((item.start - from * 60) / span) * 100}%`,
                  height: `calc(${((item.end - item.start) / span) * 100}% - 2px)`,
                }}
              >
                {item.code}
              </span>
            ))}
          </div>
        </div>
      </div>
      <MeetingList items={items} labels={labels} />
    </div>
  );
}

const DAY_NAMES: Record<ClassDay, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** The drawn week in words, for screen readers: one line per meeting, saying which schedule it belongs to. */
function MeetingList({ items, labels }: { items: readonly PlacedBlock[]; labels?: Partial<Record<PlacedBlock["variant"], string>> }) {
  return (
    <ul className="sr-only-v2" aria-label="Meetings">
      {items.map((item) => (
        <li key={item.id}>
          {item.code}, {DAY_NAMES[item.day]} {clockText(item.start)} to {clockText(item.end)}
          {labels?.[item.variant] ? `, ${labels[item.variant]}` : ""}
        </li>
      ))}
    </ul>
  );
}
