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

/* v3 glyphs from the mockups' sprite, drawn on a 24-unit grid. */
function Glyph24({ size = 20, strokeWidth = 1.75, children, ...rest }: GlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth} viewBox="0 0 24 24" {...rest}>
      {children}
    </Glyph>
  );
}

export const Plus = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M12 5v14M5 12h14" />
  </Glyph24>
);
export const Minus = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M5 12h14" />
  </Glyph24>
);
export const Undo = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M9 14.5L4 9.5l5-5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" />
  </Glyph24>
);
/** Auto's glyph: rows dropping into the term tray. */
export const TrayIn = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M12 3.5v9.5M8 9.5l4 4 4-4" />
    <path d="M4 14.5v3.3a2.2 2.2 0 0 0 2.2 2.2h11.6a2.2 2.2 0 0 0 2.2-2.2v-3.3" />
  </Glyph24>
);
export const Walk = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="13.2" cy="4.6" r="1.7" fill="currentColor" stroke="none" />
    <path d="M10 21l2.3-6.4M15 21l-2-5.2-1.7-3.1.9-4 2.8 2.6 2.7 1.1M11.2 9.3L8.4 11l-1 3.4" />
  </Glyph24>
);
export const UserGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M5 20c1.4-3.6 4-5.3 7-5.3s5.6 1.7 7 5.3" />
  </Glyph24>
);
/** The three lenses: a list for the degree, a week for the term, a route for the day. */
export const CoursesGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9" />
    <circle cx="18" cy="17.5" r="1.6" />
  </Glyph24>
);
export const WeekGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
    <path d="M3.5 9.5h17M8.5 3v3M15.5 3v3M7.5 13h3v4h-3zM13.5 13h3" />
  </Glyph24>
);
export const DayGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="6" cy="18.5" r="2" />
    <path d="M7.8 17.5c5.5-1 1.4-8.6 7.4-9.5" />
    <path d="M17.5 3.5a3.5 3.5 0 0 1 3.5 3.5c0 2.6-3.5 6-3.5 6S14 9.6 14 7a3.5 3.5 0 0 1 3.5-3.5z" />
  </Glyph24>
);

/** Ring spinner with one open quarter; constant motion, so linear. Pulses instead under reduced motion. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `ui-spinner ${className}` : "ui-spinner"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-ui=""
    />
  );
}
