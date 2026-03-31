"use client";

import type { InputHTMLAttributes } from "react";

export function SearchBar({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`field ${className}`} style={{ position: "relative" }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--faint)",
          pointerEvents: "none",
          fontSize: 14,
        }}
      >
        ⌕
      </span>
      <input className="field-input" style={{ paddingLeft: 32 }} {...rest} />
    </div>
  );
}
