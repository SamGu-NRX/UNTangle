"use client";

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx, mergeRefs } from "./cx";

type BoxProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  label?: ReactNode;
  description?: ReactNode;
};

/**
 * Native checkbox, drawn at 16px (radius 4, brand fill with a white check;
 * indeterminate is a white 8×2 bar). The native input keeps keyboard,
 * form and screen-reader behaviour; the label and box share one hit area.
 */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  className,
  ref,
  ...rest
}: BoxProps & { indeterminate?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const box = (
    <input
      ref={mergeRefs(ref, inputRef)}
      type="checkbox"
      className="ui-check__box"
      data-ui=""
      {...rest}
    />
  );
  return label ? (
    <label className={cx("ui-check", rest.disabled && "ui-check--disabled", className)}>
      {box}
      <span className="ui-check__text">
        <span>{label}</span>
        {description ? <span className="ui-check__description">{description}</span> : null}
      </span>
    </label>
  ) : (
    box
  );
}

/** Native radio at 16px: 1.5px ring, checked ring and 6px dot in brand. */
export function Radio({ label, description, className, ref, ...rest }: BoxProps) {
  const dot = <input ref={ref} type="radio" className="ui-check__box ui-check__box--radio" data-ui="" {...rest} />;
  return label ? (
    <label className={cx("ui-check", rest.disabled && "ui-check--disabled", className)}>
      {dot}
      <span className="ui-check__text">
        <span>{label}</span>
        {description ? <span className="ui-check__description">{description}</span> : null}
      </span>
    </label>
  ) : (
    dot
  );
}
