"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "./anchored";
import { cx, mergeRefs } from "./cx";
import { Check, ChevronDown } from "./icons";
import { firstEnabled, lastEnabled, stepEnabled, typeaheadMatch } from "./listbox-nav";
import { usePresence } from "./use-presence";

export type SelectOption = { value: string; label: string; meta?: string; disabled?: boolean };

export type SelectProps = Omit<ComponentPropsWithRef<"select">, "size" | "multiple"> & {
  label?: string;
  /** Keeps the label for screen readers but does not draw it. */
  hideLabel?: boolean;
  /** Options with optional right-aligned meta. Without this, `<option>` children are read. */
  options?: SelectOption[];
  help?: ReactNode;
  error?: string | null;
  size?: "md" | "sm";
  /** Shown when no option matches the value. */
  placeholder?: string;
  onValueChange?: (value: string) => void;
};

const EXIT_MS = 120;

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

/** Reads `<option>` (and `<optgroup>`-nested) children into option records. */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === "optgroup") {
      out.push(...optionsFromChildren(child.props.children));
    } else if (child.type === "option") {
      const label = textContent(child.props.children) || child.props.label || "";
      out.push({ value: String(child.props.value ?? label), label, disabled: child.props.disabled });
    }
  });
  return out;
}

/**
 * A field-styled select: a custom trigger (APG select-only combobox) that
 * opens a Listbox popover, on every pointer type. On touch the options grow
 * to 44px with 16px text; the browser's own picker is never shown.
 *
 * A hidden native `<select>` sits behind it, never displayed or focusable.
 * It holds the value so the field submits with a form, and choosing an
 * option sets its value and dispatches a real `change` event, so callers
 * written against the v1 Select (`onChange={(e) => e.target.value}`) keep
 * working without a fabricated event.
 */
export function Select({
  label,
  hideLabel,
  options: optionsProp,
  help,
  error,
  size = "md",
  placeholder,
  onValueChange,
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id: idProp,
  ref,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...rest
}: SelectProps) {
  const options = optionsProp ?? optionsFromChildren(children);
  const baseId = useId();
  const triggerId = idProp ?? `${baseId}-trigger`;
  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;
  const helpId = `${baseId}-help`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const [uncontrolled, setUncontrolled] = useState<string>(() =>
    defaultValue !== undefined ? String(defaultValue) : (options[firstEnabled(options)]?.value ?? ""),
  );
  const current = value !== undefined && value !== null ? String(value) : uncontrolled;
  const selectedIndex = options.findIndex((option) => option.value === current);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { mounted, state } = usePresence(open, EXIT_MS);
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef({ text: "", at: 0 });

  useAnchoredPosition(mounted, triggerRef, listRef, { align: "start", offset: 4, matchWidth: true });

  // Keep the active option in view as the keyboard moves it.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Names and descriptions belong on the control people operate, merged
  // with the field's own label and help text.
  const labelledBy = [label ? labelId : null, ariaLabelledBy].filter(Boolean).join(" ") || undefined;
  const describedBy = [error || help ? helpId : null, ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  const invalid = error ? true : ariaInvalid;

  const handleNativeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setUncontrolled(event.target.value);
    onValueChange?.(event.target.value);
    onChange?.(event);
  };

  const commit = (index: number) => {
    const option = options[index];
    const native = nativeRef.current;
    if (!option || option.disabled || !native) return;
    if (option.value !== current) {
      // React tracks <select> value through its own setter; going through the
      // prototype setter and a real change event is what makes React fire
      // the caller's onChange exactly as a native pick would.
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(native, option.value);
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const closeList = () => setOpen(false);

  const runTypeahead = (key: string) => {
    const now = Date.now();
    const text = now - typeahead.current.at < 500 ? typeahead.current.text + key : key;
    typeahead.current = { text, at: now };
    return typeaheadMatch(options, text, open ? active : selectedIndex);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled(options));
      } else if (key === "Home") {
        event.preventDefault();
        openAt(firstEnabled(options));
      } else if (key === "End") {
        event.preventDefault();
        openAt(lastEnabled(options));
      } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const match = runTypeahead(key);
        if (match >= 0) openAt(match);
      }
      return;
    }
    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey) return;
        setActive((i) => stepEnabled(options, i, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey) {
          commit(active);
          closeList();
          return;
        }
        setActive((i) => stepEnabled(options, i, -1));
        return;
      case "Home":
        event.preventDefault();
        setActive(firstEnabled(options));
        return;
      case "End":
        event.preventDefault();
        setActive(lastEnabled(options));
        return;
      case "PageDown":
        event.preventDefault();
        setActive((i) => {
          let next = i;
          for (let n = 0; n < 10; n += 1) next = stepEnabled(options, next, 1);
          return next;
        });
        return;
      case "PageUp":
        event.preventDefault();
        setActive((i) => {
          let next = i;
          for (let n = 0; n < 10; n += 1) next = stepEnabled(options, next, -1);
          return next;
        });
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(active);
        closeList();
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeList();
        return;
      case "Tab":
        // Tab picks the active option and lets focus move on, per the APG.
        commit(active);
        closeList();
        return;
    }
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const match = runTypeahead(key);
      if (match >= 0) setActive(match);
    }
  };

  return (
    <div
      className={cx("ui-select", size === "sm" && "ui-select--sm", className)}
      data-invalid={error ? "" : undefined}
      data-ui=""
    >
      {label ? (
        <label
          id={labelId}
          htmlFor={triggerId}
          className={cx("ui-label", hideLabel && "sr-only-v2")}
          onClick={(event) => {
            // Like a native select's label: focus the field, do not open it.
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          {label}
        </label>
      ) : null}
      <div className="ui-select__control">
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          className="ui-field ui-select__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : ariaLabel}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          data-open={open ? "" : undefined}
          onClick={() => (open ? closeList() : openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled(options)))}
          onKeyDown={onTriggerKeyDown}
          onBlur={() => setOpen(false)}
        >
          <span className={cx("ui-select__value", !selected && "ui-select__value--placeholder")}>
            {selected ? selected.label : (placeholder ?? "Choose…")}
          </span>
          <ChevronDown className="ui-select__chevron" />
        </button>
        <select
          {...rest}
          ref={mergeRefs(ref, nativeRef)}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          className="ui-select__native"
          value={current}
          onChange={handleNativeChange}
          disabled={disabled}
        >
          {placeholder && !selected ? (
            <option value={current} disabled>
              {placeholder}
            </option>
          ) : null}
          {optionsProp
            ? options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
            : children}
        </select>
      </div>
      {error ? (
        <p id={helpId} className="ui-help ui-help--error">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="ui-help">
          {help}
        </p>
      ) : null}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={labelledBy}
              aria-label={labelledBy ? undefined : ariaLabel}
              className="ui-pop ui-listbox"
              data-state={state}
              data-ui=""
              // Keep focus on the trigger while the pointer works the list.
              onPointerDown={(event) => event.preventDefault()}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-disabled={option.disabled || undefined}
                  className="ui-option"
                  data-active={index === active ? "" : undefined}
                  onPointerMove={() => {
                    if (!option.disabled && active !== index) setActive(index);
                  }}
                  onClick={() => {
                    if (option.disabled) return;
                    commit(index);
                    closeList();
                  }}
                >
                  <span className="ui-option__label">{option.label}</span>
                  {index === selectedIndex ? (
                    <Check size={14} className="ui-option__check" />
                  ) : option.meta ? (
                    <span className="ui-option__meta">{option.meta}</span>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
