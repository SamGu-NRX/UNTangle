"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./courses.module.css";
import { useOutsidePress, usePresence } from "./hooks";

export type MenuItem =
  | { key: string; label: string; onSelect: () => void }
  | { key: string; label: string; href: string };

type Props = {
  label: string;
  items: readonly MenuItem[];
  trigger: ReactNode;
  triggerClassName: string;
  align?: "start" | "end";
};

/** Menu button (WAI-ARIA APG): ↓ ↑ Home End move, Enter activates, Esc returns focus. */
export function Menu({ label, items, trigger, triggerClassName, align = "end" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const presence = usePresence(open, 120);
  useOutsidePress(wrapRef, open, () => setOpen(false));

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (event: React.KeyboardEvent) => {
    const last = items.length - 1;
    if (event.key === "ArrowDown") setActive((index) => (index >= last ? 0 : index + 1));
    else if (event.key === "ArrowUp") setActive((index) => (index <= 0 ? last : index - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") close(false);
    else return;
    if (event.key !== "Tab") {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          setActive(0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(event.key === "ArrowUp" ? items.length - 1 : 0);
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {presence.mounted ? (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          className={styles.popover}
          data-state={presence.state}
          data-align={align}
          style={{ minWidth: 220 }}
          onKeyDown={onMenuKey}
        >
          {items.map((item, index) => {
            const common = {
              role: "menuitem",
              tabIndex: index === active ? 0 : -1,
              className: styles.menuItem,
              "data-active": index === active,
              onPointerMove: () => setActive(index),
            } as const;
            return "href" in item ? (
              <Link
                key={item.key}
                href={item.href}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                {...common}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                {...common}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
