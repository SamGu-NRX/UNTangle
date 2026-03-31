"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

export function Field({
  label,
  helper,
  error,
  className = "",
  rightSlot,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  helper?: ReactNode;
  error?: string | null;
  rightSlot?: ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`field block ${className}`}>
      <span className="field-label">{label}</span>
      <span style={{ position: "relative", display: "block" }}>
        <input id={id} className="field-input" {...rest} />
        {rightSlot ? (
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
            {rightSlot}
          </span>
        ) : null}
      </span>
      {error ? (
        <span style={{ marginTop: 6, color: "var(--danger)", fontSize: 12, display: "block" }}>
          {error}
        </span>
      ) : helper ? (
        <span style={{ marginTop: 6, color: "var(--copy)", fontSize: 12, display: "block" }}>
          {helper}
        </span>
      ) : null}
    </label>
  );
}
