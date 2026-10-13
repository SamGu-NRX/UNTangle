"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import styles from "./courses.module.css";
import { useOutsidePress, usePresence } from "./hooks";

export type ListboxOption = { value: string; label: string; meta?: string };

export type ListboxHandle = { open: () => void; focus: () => void };

type Props = {
  /** Accessible name; shown visually only through the trigger's value. */
  label: string;
  options: readonly ListboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  variant?: "field" | "title";
  align?: "start" | "end";
  className?: string;
};

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3.5 5.5 7 9l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Check = () => (
  <svg className={styles.optionCheck} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="m3 7.5 2.5 2.5L11 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Select-only combobox (WAI-ARIA APG "select-only combobox"). Focus stays on
 * the trigger; the active option is announced through aria-activedescendant.
 * Keys: ↓ ↑ Home End PageUp PageDown move, Enter Space choose, Esc closes
 * without choosing, Tab chooses and moves on, typing jumps to a label.
 */
export const Listbox = forwardRef<ListboxHandle, Props>(function Listbox(
  { label, options, value, onChange, placeholder, variant = "field", align = "start", className },
  forwarded,
) {
  const id = useId();
  const listId = `${id}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", at: 0 });
  const presence = usePresence(open, 120);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);

  const show = (index = selectedIndex) => {
    setActive(Math.min(Math.max(index, 0), options.length - 1));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) onChange(option.value);
  };

  useImperativeHandle(forwarded, () => ({
    open: () => {
      triggerRef.current?.focus();
      show();
    },
    focus: () => triggerRef.current?.focus(),
  }));
  useOutsidePress(wrapRef, open, () => setOpen(false));
  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const jumpTo = (key: string) => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at > 600 ? key.toLowerCase() : state.text + key.toLowerCase();
    state.at = now;
    const start = open ? active + (state.text.length === 1 ? 1 : 0) : selectedIndex + 1;
    for (let step = 0; step < options.length; step++) {
      const index = (start + step) % options.length;
      if (options[index].label.toLowerCase().startsWith(state.text)) return index;
    }
    return -1;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show(event.key === "ArrowUp" && event.altKey === false && value === null ? last : selectedIndex);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        show(event.key === "Home" ? 0 : last);
      } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && event.key !== " ") {
        const index = jumpTo(event.key);
        if (index >= 0) show(index);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey) choose(active);
        else setActive((index) => Math.min(index + 1, last));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey) choose(active);
        else setActive((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(last);
        break;
      case "PageDown":
        event.preventDefault();
        setActive((index) => Math.min(index + 10, last));
        break;
      case "PageUp":
        event.preventDefault();
        setActive((index) => Math.max(index - 10, 0));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case "Tab":
        choose(active);
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          const index = jumpTo(event.key);
          if (index >= 0) setActive(index);
        }
    }
  };

  const optionId = (index: number) => `${id}-opt-${index}`;
  const triggerClass = [styles.listboxTrigger, variant === "title" ? styles.titleTrigger : "", className ?? ""].join(" ");

  return (
    <div ref={wrapRef} className={styles.listboxWrap}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        data-empty={selected ? "false" : "true"}
        className={triggerClass}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? placeholder}</span>
        <Chevron />
      </button>
      {presence.mounted ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className={styles.popover}
          data-state={presence.state}
          data-align={align}
          style={{ margin: 0, listStyle: "none" }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-active={open && index === active}
              className={styles.option}
              onPointerMove={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                choose(index);
                triggerRef.current?.focus();
              }}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              {option.meta ? <span className={styles.optionMeta}>{option.meta}</span> : null}
              {option.value === value ? <Check /> : <span className={styles.optionCheck} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      ) : (
        // aria-controls must name an element that exists.
        <ul id={listId} role="listbox" aria-label={label} hidden />
      )}
    </div>
  );
});
