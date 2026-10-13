"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * Where data came from ("From transcript", "Sample", "Approx."), as a 20px
 * dotted tag with a one-sentence tooltip. Placed once per group header or
 * panel section, never per row and never full width. It is a button so
 * keyboard and touch users can reach the explanation too.
 */
export function ProvenanceTag({ children, source, glyph }: { children: ReactNode; source: string; glyph?: ReactNode }) {
  return (
    <Tooltip content={source} openOnTap>
      <button type="button" className="ui-tag" data-ui="">
        {glyph ? <span aria-hidden="true">{glyph}</span> : null}
        {children}
      </button>
    </Tooltip>
  );
}
