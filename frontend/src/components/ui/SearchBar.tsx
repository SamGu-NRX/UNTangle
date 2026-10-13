"use client";

import type { InputHTMLAttributes } from "react";
import { SearchField } from "./SearchField";

/**
 * @deprecated Use `SearchField`. Kept so the v1 courses filter compiles
 * unchanged; it renders the v2 field. The accessible name comes from
 * `aria-label`, else the placeholder.
 */
export function SearchBar({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "size">) {
  return <SearchField className={className} label={rest["aria-label"] ?? rest.placeholder ?? "Search"} {...rest} />;
}
