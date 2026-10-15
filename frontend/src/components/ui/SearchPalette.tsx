"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { SearchGlyph, Spinner } from "./icons";
import { Kbd } from "./Kbd";
import { useModalLayer } from "./modal-layer";

/**
 * One result model for ⌘K and the phone search sheet (DESIGN.md §2): the
 * Courses view owns the real search and hands its sections in here.
 */
export type SearchItem = {
  id: string;
  /** Course code or short identifier, set as a `.ui-code`. */
  code?: string;
  title: string;
  /** Right-hand meta: status or "Needs CSCE 2110". */
  meta?: string;
  metaTone?: "default" | "danger";
};
export type SearchSection = { id: string; label: string; items: SearchItem[] };

export type SearchPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  sections: SearchSection[];
  /** Enter opens the item; ⌘/Ctrl+Enter calls with `plan: true`. */
  onSelect: (item: SearchItem, opts: { plan: boolean }) => void;
  placeholder?: string;
  loading?: boolean;
  /** Shown while the query is empty. */
  emptyQueryHint?: ReactNode;
  /** Show the ⌘↵ "plan / unplan" hint; only when onSelect honours `plan`. */
  planShortcut?: boolean;
};

/**
 * ⌘K palette. No open or close animation: it is summoned from the keyboard
 * many times a session (DESIGN.md §6). Focus stays in the input; ↑/↓ move
 * the active result (aria-activedescendant), Enter opens, ⌘↵ plans,
 * Escape closes and returns focus to whatever opened it. Below 760px it
 * fills the screen as a sheet with a Cancel button and the keyboard up.
 */
export function SearchPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  sections,
  onSelect,
  placeholder = "Search courses",
  loading,
  emptyQueryHint = "Type a course code or title.",
  planShortcut = false,
}: SearchPaletteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const flat = sections.flatMap((section) => section.items);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    // A new query starts from the top result.
    setLastQuery(query);
    setActiveIndex(0);
  }
  const active = flat.length ? Math.min(activeIndex, flat.length - 1) : -1;
  const itemId = (index: number) => `${baseId}-item-${index}`;

  useModalLayer(open, rootRef, { onEscape: () => onOpenChange(false), initialFocus: inputRef });

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(itemId(active))?.scrollIntoView({ block: "nearest" });
    // itemId derives from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && flat.length) {
      event.preventDefault();
      setActiveIndex((active + 1) % flat.length);
    } else if (event.key === "ArrowUp" && flat.length) {
      event.preventDefault();
      setActiveIndex((active - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      onSelect(flat[active], { plan: event.metaKey || event.ctrlKey });
    }
  };

  const count = flat.length;
  const status = !query.trim() ? "" : loading ? "Searching…" : `${count} ${count === 1 ? "result" : "results"}`;
  let running = -1;

  return createPortal(
    <div ref={rootRef} className="ui-palette-layer" data-ui="" tabIndex={-1}>
      <div className="ui-palette-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div role="dialog" aria-modal="true" aria-label={placeholder} className="ui-palette">
        <div className="ui-palette__input">
          {loading ? <Spinner size={16} /> : <SearchGlyph size={18} />}
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? itemId(active) : undefined}
            aria-label={placeholder}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Kbd className="ui-palette__esc">esc</Kbd>
          <button type="button" className="ui-palette__cancel" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </div>
        <div className="ui-palette__body">
          <div id={listId} role="listbox" aria-label="Results" className="ui-palette__list">
            {sections.map((section) =>
              section.items.length ? (
                <div key={section.id} role="group" aria-labelledby={`${baseId}-${section.id}`}>
                  <div id={`${baseId}-${section.id}`} className="ui-palette__section" role="presentation">
                    {section.label}
                  </div>
                  {section.items.map((item) => {
                    running += 1;
                    const index = running;
                    return (
                      <div
                        key={item.id}
                        id={itemId(index)}
                        role="option"
                        aria-selected={index === active}
                        className="ui-palette__item"
                        onPointerMove={() => index !== active && setActiveIndex(index)}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={(event) => onSelect(item, { plan: event.metaKey || event.ctrlKey })}
                      >
                        <span className="ui-code">{item.code}</span>
                        <span className="ui-palette__title">{item.title}</span>
                        <span className={cx("ui-palette__meta", item.metaTone === "danger" && "ui-palette__meta--danger")}>
                          {item.meta}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null,
            )}
          </div>
          {!query.trim() ? (
            <p className="ui-palette__empty">{emptyQueryHint}</p>
          ) : count === 0 && !loading ? (
            <p className="ui-palette__empty">No courses match “{query.trim()}”.</p>
          ) : null}
        </div>
        <div className="ui-palette__foot" aria-hidden="true">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          {planShortcut ? (
            <span>
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> plan / unplan
            </span>
          ) : null}
        </div>
        <p className="sr-only-v2" role="status">
          {status}
        </p>
      </div>
    </div>,
    document.body,
  );
}
