"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * Where data came from ("From transcript, Oct 13", "Sample sections"), as a
 * 20px dotted tag with a one-sentence tooltip. Once per group or panel, never
 * per row. It is a button so keyboard and touch users can reach the
 * explanation too.
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
