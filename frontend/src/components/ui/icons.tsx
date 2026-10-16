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

/* Week's glyphs (03-schedule-builder.html sprite). */
export const SlidersGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Glyph24>
);
export const ShareGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M6 11.5H5.5A1.5 1.5 0 0 0 4 13v5.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13a1.5 1.5 0 0 0-1.5-1.5H18" />
  </Glyph24>
);
export const LockGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
  </Glyph24>
);
export const AlertGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />
  </Glyph24>
);
export const ImageGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 15.5l-5-4.5-8.5 8" />
  </Glyph24>
);
export const CopyGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
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

/* Week preferences' glyphs (r3 preferences mockup), on the same 24px grid. */
export const SunriseGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M3 18h18M7 18a5 5 0 0 1 10 0" />
    <path d="M12 4v3M5.6 9.6l1.4 1.4M18.4 9.6 17 11M9.5 5.5 12 3l2.5 2.5" />
  </Glyph24>
);
export const MoonGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
  </Glyph24>
);
export const CalendarOffGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3M10 13.5l4 4M14 13.5l-4 4" />
  </Glyph24>
);
export const BriefcaseGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
    <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
  </Glyph24>
);
export const BookGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Z" />
    <path d="M12 6.5v13" />
  </Glyph24>
);
export const GearGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="12" cy="12" r="6" />
    <path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" />
  </Glyph24>
);
export const UnlockGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" />
  </Glyph24>
);
export const BanGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </Glyph24>
);
export const PointerGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M6 4.5 18 11l-5.2 1.3L10.5 18Z" />
  </Glyph24>
);
export const TouchGlyph = (p: GlyphProps) => (
  <Glyph24 {...p}>
    <path d="M9 13V6.5a1.5 1.5 0 0 1 3 0V12M12 11a1.5 1.5 0 0 1 3 0v1M15 11.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1a5 5 0 0 1-4-2l-2.2-3a1.4 1.4 0 0 1 2.2-1.8L9 14.5" />
  </Glyph24>
);
