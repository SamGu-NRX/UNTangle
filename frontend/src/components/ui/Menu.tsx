"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type Align } from "./anchored";
import { cx } from "./cx";
import { Kbd } from "./Kbd";
import { usePresence } from "./use-presence";

export type MenuItem = {
  kind?: "item";
  id: string;
  label: ReactNode;
  /** Text used for typeahead when `label` is not a plain string. */
  textValue?: string;
  icon?: ReactNode;
  shortcut?: string;
  meta?: ReactNode;
  onSelect?: () => void;
  /** Internal route: renders a link item. */
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
  /** Marks the item for the thing currently shown (e.g. the open plan). */
  current?: boolean;
};
export type MenuEntry = MenuItem | { kind: "separator"; id: string } | { kind: "label"; id: string; label: ReactNode };

export type MenuTriggerProps = {
  ref: Ref<HTMLButtonElement>;
  id: string;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

export type MenuProps = {
  /** Accessible name of the menu. */
  label: string;
  items: MenuEntry[];
  trigger: (props: MenuTriggerProps) => ReactNode;
  align?: Align;
  /** Extra content above the items (e.g. a status line). Not focusable by arrows. */
  header?: ReactNode;
  className?: string;
};

const EXIT_MS = 120;

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry.kind === undefined || entry.kind === "item";
}

function textOf(item: MenuItem): string {
  return item.textValue ?? (typeof item.label === "string" ? item.label : "");
}

/** Splits entries into groups at separators; a label heads its group. */
function groupEntries(entries: MenuEntry[]) {
  const groups: Array<{ id: string; label?: { id: string; node: ReactNode }; items: MenuItem[] }> = [];
  let current: (typeof groups)[number] = { id: "g0", items: [] };
  for (const entry of entries) {
    if (entry.kind === "separator") {
      groups.push(current);
      current = { id: entry.id, items: [] };
    } else if (entry.kind === "label") {
      if (current.items.length || current.label) {
        groups.push(current);
        current = { id: entry.id, items: [] };
      }
      current.label = { id: entry.id, node: entry.label };
    } else {
      current.items.push(entry);
    }
  }
  groups.push(current);
  return groups.filter((group) => group.items.length || group.label);
}

/**
 * Dropdown menu (APG menu button). Enter, Space or ↓ opens on the first
 * item, ↑ on the last; arrows move with wrap; Home/End; typing jumps to an
 * item; Escape closes and returns focus to the trigger; Tab closes.
 */
export function Menu({ label, items, trigger, align = "start", header, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, EXIT_MS);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const typeahead = useRef({ text: "", at: 0 });
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const triggerId = `${baseId}-trigger`;

  useAnchoredPosition(mounted, triggerRef, menuRef, { align, offset: 6 });

  const itemNodes = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Focus the first or last item once the menu is in the DOM.
  useEffect(() => {
    if (!open) return;
    const nodes = itemNodes();
    const target = focusOnOpen.current === "last" ? nodes[nodes.length - 1] : nodes[0];
    (target ?? menuRef.current)?.focus({ preventScroll: true });
  }, [open]);

  // Pointer down anywhere outside the trigger and menu closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const openWith = (where: "first" | "last") => {
    focusOnOpen.current = where;
    setOpen(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(!item.href);
    item.onSelect?.();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nodes = itemNodes();
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => nodes[(next + nodes.length) % nodes.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? nodes.length - 1 : index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(nodes.length - 1);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case "Tab":
        event.preventDefault();
        close(true);
        return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const buffer = now - typeahead.current.at < 500 ? typeahead.current.text + event.key : event.key;
      typeahead.current = { text: buffer.toLowerCase(), at: now };
      const ordered = [...nodes.slice(index + 1), ...nodes.slice(0, index + 1)];
      const match = ordered.find((node) => (node.dataset.text ?? "").toLowerCase().startsWith(typeahead.current.text));
      match?.focus();
    }
  };

  const groups = groupEntries(items);

  return (
    <>
      {trigger({
        ref: triggerRef,
        id: triggerId,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: () => (open ? close(false) : openWith("first")),
        onKeyDown: onTriggerKeyDown,
      })}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              tabIndex={-1}
              className={cx("ui-pop ui-menu", className)}
              data-state={state}
              data-ui=""
              onKeyDown={onMenuKeyDown}
            >
              {header ? <div className="ui-menu__header">{header}</div> : null}
              {groups.map((group, groupIndex) => (
                <div
                  key={group.id}
                  role="group"
                  aria-labelledby={group.label ? `${baseId}-${group.label.id}` : undefined}
                  className={cx("ui-menu__group", groupIndex > 0 && "ui-menu__group--separated")}
                >
                  {group.label ? (
                    <div id={`${baseId}-${group.label.id}`} className="ui-menu__label">
                      {group.label.node}
                    </div>
                  ) : null}
                  {group.items.map((item) => {
                    const common = {
                      role: "menuitem" as const,
                      tabIndex: -1,
                      "data-text": textOf(item),
                      "aria-disabled": item.disabled || undefined,
                      "aria-current": item.current ? ("true" as const) : undefined,
                      className: cx(
                        "ui-option",
                        item.destructive && "ui-option--danger",
                        item.current && "ui-option--current",
                      ),
                      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
                        if (!item.disabled && event.pointerType === "mouse") event.currentTarget.focus({ preventScroll: true });
                      },
                    };
                    const body = (
                      <>
                        {item.icon ? <span className="ui-option__icon">{item.icon}</span> : null}
                        <span className="ui-option__label">{item.label}</span>
                        {item.meta || item.shortcut ? (
                          <span className="ui-option__meta">
                            {item.meta}
                            {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
                          </span>
                        ) : null}
                      </>
                    );
                    return item.href && !item.disabled ? (
                      <Link
                        key={item.id}
                        href={item.href}
                        {...common}
                        onClick={() => select(item)}
                        onKeyDown={(event) => {
                          // Menu items activate on Space too; links only do Enter natively.
                          if (event.key === " ") {
                            event.preventDefault();
                            event.currentTarget.click();
                          }
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        key={item.id}
                        {...common}
                        onClick={() => select(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            select(item);
                          }
                        }}
                      >
                        {body}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
