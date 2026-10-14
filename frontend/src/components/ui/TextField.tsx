"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "./cx";

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  label: string;
  hideLabel?: boolean;
  /** 12.5px line under the field. Replaced by `error` when there is one. */
  help?: ReactNode;
  /** Shown as red help text with a red border; never as a red box. */
  error?: string | null;
  /** 16px glyph or short text inside the field, before or after the value. */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** A link at the far end of the label row, such as "Forgot it?". */
  labelAside?: ReactNode;
  size?: "md" | "sm";
};

/**
 * Label (12.5 600) above, field, then help or error text under it. The
 * error is tied to the input with aria-describedby and aria-invalid.
 */
export function TextField({
  label,
  hideLabel,
  help,
  error,
  leading,
  trailing,
  labelAside,
  size = "md",
  className,
  id: idProp,
  ...rest
}: TextFieldProps) {
  const baseId = useId();
  const id = idProp ?? `${baseId}-input`;
  const helpId = `${baseId}-help`;
  const describedBy = [rest["aria-describedby"], error || help ? helpId : null].filter(Boolean).join(" ") || undefined;
  const labelEl = (
    <label htmlFor={id} className={cx("ui-label", hideLabel && "sr-only-v2")}>
      {label}
    </label>
  );
  return (
    <div className={cx("ui-textfield", size === "sm" && "ui-textfield--sm", className)} data-invalid={error ? "" : undefined}>
      {labelAside ? (
        <div className="ui-textfield__labelrow">
          {labelEl}
          {labelAside}
        </div>
      ) : (
        labelEl
      )}
      <div className="ui-field ui-field--input" data-disabled={rest.disabled ? "" : undefined}>
        {leading ? <span className="ui-field__adornment">{leading}</span> : null}
        <input id={id} className="ui-field__input" aria-invalid={error ? true : undefined} {...rest} aria-describedby={describedBy} />
        {trailing ? <span className="ui-field__adornment">{trailing}</span> : null}
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
    </div>
  );
}
