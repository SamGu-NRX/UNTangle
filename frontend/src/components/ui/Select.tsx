"use client";

import type { SelectHTMLAttributes } from "react";
import { useId } from "react";

export function Select({
  label,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`field block ${className}`}>
      {label ? <span className="field-label">{label}</span> : null}
      <select id={id} className="field-input" style={{ appearance: "auto" }} {...rest}>
        {children}
      </select>
    </label>
  );
}
