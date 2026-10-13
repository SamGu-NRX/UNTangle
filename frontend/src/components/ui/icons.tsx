/*
 * Glyphs drawn on a 16px grid with 1.6px strokes, matching controls.html.
 * All are decorative (aria-hidden); the control around them carries the name.
 */
import type { SVGProps } from "react";

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 16, strokeWidth = 1.6, children, ...rest }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronDown = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M4 6l4 4 4-4" />
  </Glyph>
);
export const ChevronLeft = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M10 4L6 8l4 4" />
  </Glyph>
);
export const ChevronRight = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M6 4l4 4-4 4" />
  </Glyph>
);
export const Check = (p: GlyphProps) => (
  <Glyph strokeWidth={2} {...p}>
    <path d="M3.5 8.5 6.5 11.5 12.5 5" />
  </Glyph>
);
export const SearchGlyph = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Glyph>
);
export const Close = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Glyph>
);
export const CalendarGlyph = (p: GlyphProps) => (
  <Glyph strokeWidth={1.5} {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
  </Glyph>
);
export const MoreGlyph = (p: GlyphProps) => (
  <Glyph {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </Glyph>
);
export const ExternalGlyph = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M6 4h6v6M12 4l-7 7" />
  </Glyph>
);

/** 14px ring spinner; the ring turns at 0.8s, constant motion, so linear. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `ui-spinner ${className}` : "ui-spinner"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-ui=""
    />
  );
}
