"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { CoursesGlyph, DayGlyph, WeekGlyph } from "@/components/ui/icons";
import { LENSES, type Lens } from "./routes";

const GLYPHS: Record<Lens, (active: boolean) => ReactNode> = {
  courses: (active) => <CoursesGlyph size={24} strokeWidth={active ? 2.1 : 1.75} />,
  week: (active) => <WeekGlyph size={24} strokeWidth={active ? 2.1 : 1.75} />,
  day: (active) => <DayGlyph size={24} strokeWidth={active ? 2.1 : 1.75} />,
};

type Props = {
  lens: Lens | null;
  hrefs: Record<Lens, string>;
  onPick: (lens: Lens, event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * The phone's three tabs: a 24px glyph and an 11px label, 56px plus the
 * home-indicator inset, frosted. Tabs are not history (DESIGN.md §3.4): a
 * switch replaces the entry, so Back leaves the app's screen rather than
 * stepping through tabs. Switching never animates.
 */
export function TabBar({ lens, hrefs, onPick }: Props) {
  return (
    <nav aria-label="Views" className="shell-tabbar" data-glass="">
      {LENSES.map((item) => {
        const active = item.id === lens;
        return (
          <Link
            key={item.id}
            href={hrefs[item.id]}
            replace
            scroll={false}
            className="shell-tab"
            aria-current={active ? "page" : undefined}
            onClick={(event) => onPick(item.id, event)}
          >
            {GLYPHS[item.id](active)}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
