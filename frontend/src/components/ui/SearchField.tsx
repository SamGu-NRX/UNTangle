"use client";

import { useRef, type ComponentPropsWithRef } from "react";
import { cx, mergeRefs } from "./cx";
import { Close, SearchGlyph, Spinner } from "./icons";
import { Kbd } from "./Kbd";

export type SearchFieldProps = Omit<ComponentPropsWithRef<"input">, "size" | "type"> & {
  /** Accessible name when there is no visible label. */
  label?: string;
  /** Swaps the ⌕ glyph for a 14px spinner. */
  loading?: boolean;
  /** Clears the query; the × replaces the shortcut hint while there is text. */
  onClear?: () => void;
  /** Shortcut hint shown on fine pointers while empty, e.g. "⌘K". */
  shortcut?: string;
  size?: "md" | "lg";
};

/**
 * Search input: ⌕ at left, ⌘K hint at right on desktop, a 20px clear
 * button once there is text. 40px tall and 16px text on coarse pointers.
 */
export function SearchField({
  label = "Search",
  loading,
  onClear,
  shortcut,
  size = "md",
  className,
  value,
  ref,
  ...rest
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasText = typeof value === "string" ? value.length > 0 : false;
  return (
    <div className={cx("ui-field ui-search", size === "lg" && "ui-search--lg", className)} data-ui="">
      <span className="ui-field__adornment">{loading ? <Spinner /> : <SearchGlyph />}</span>
      <input
        ref={mergeRefs(ref, inputRef)}
        type="search"
        aria-label={rest["aria-labelledby"] ? undefined : label}
        className="ui-field__input"
        autoComplete="off"
        spellCheck={false}
        value={value}
        {...rest}
      />
      {hasText && onClear ? (
        <button
          type="button"
          className="ui-search__clear"
          aria-label="Clear search"
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
        >
          <Close size={14} />
        </button>
      ) : shortcut ? (
        <Kbd className="ui-search__kbd">{shortcut}</Kbd>
      ) : null}
    </div>
  );
}

export type SearchTriggerProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  placeholder?: string;
  shortcut?: string;
  /** Folds to a 36px square with the field's fill and glyph. */
  compact?: boolean;
};

/**
 * A button drawn as the search field. It opens the search palette rather
 * than taking text itself, so it announces as a button with the shortcut.
 * Its name comes from a visually hidden label that is always in the
 * accessibility tree, so it holds whether the visible text shows, is hidden
 * by a layout's CSS (the shell folds it to an icon on narrow screens), or
 * is left out (`compact`).
 */
export function SearchTrigger({
  placeholder = "Search courses",
  shortcut = "⌘K",
  compact,
  className,
  ...rest
}: SearchTriggerProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className={cx("ui-search-trigger", compact && "ui-search-trigger--compact", className)}
      data-ui=""
      {...rest}
    >
      <SearchGlyph />
      <span className="sr-only-v2">{placeholder}</span>
      {compact ? null : (
        <span className="ui-search-trigger__visible" aria-hidden="true">
          <span className="ui-search-trigger__text">{placeholder}</span>
          {/* An empty shortcut (Courses' phone field) drew an empty key cap. */}
          {shortcut ? <Kbd className="ui-search__kbd">{shortcut}</Kbd> : null}
        </span>
      )}
    </button>
  );
}
